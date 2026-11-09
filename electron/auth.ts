import Database from 'better-sqlite3'
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { z } from 'zod'
import type { AuthAccess, AuthState, UserAccount, SecurityEvent, Shop } from '../shared/contracts'
import { ownerOperations, staffOperations } from '../shared/permissions'

const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Use letters, numbers, dots, underscores or hyphens.')
const newPassword = z.string().min(12, 'Use at least 12 characters for your password.').max(128)
const passwordInput = z.string().min(1).max(128)
const confirmed = <T extends { password: string; confirmPassword: string }>(data: T) =>
  data.password === data.confirmPassword
const setupSchema = z
  .object({
    username,
    password: newPassword,
    confirmPassword: z.string().max(128),
    shopName: z.string().trim().min(1).max(120).optional(),
  })
  .refine(confirmed, 'Passwords do not match.')
const signInSchema = z.object({ username, password: passwordInput })
const changeSchema = z
  .object({
    currentPassword: passwordInput,
    password: newPassword,
    confirmPassword: z.string().max(128),
  })
  .refine(confirmed, 'Passwords do not match.')
  .refine(
    (data) => data.password !== data.currentPassword,
    'Choose a password different from your current or temporary password.',
  )
const resetSchema = z
  .object({
    username,
    recoveryCode: z.string().min(1).max(128),
    password: newPassword,
    confirmPassword: z.string().max(128),
  })
  .refine(confirmed, 'Passwords do not match.')
const createSchema = z
  .object({
    username,
    displayName: z.string().trim().min(1).max(120),
    role: z.enum(['owner', 'staff']),
    password: newPassword,
    confirmPassword: z.string().max(128),
    currentPassword: passwordInput,
  })
  .refine(confirmed, 'Passwords do not match.')
const updateSchema = z.object({
  id: z.number().int().positive(),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(['owner', 'staff']),
  active: z.boolean(),
  unlock: z.boolean().default(false),
  currentPassword: passwordInput,
})
const adminResetSchema = z
  .object({
    id: z.number().int().positive(),
    password: newPassword,
    confirmPassword: z.string().max(128),
    currentPassword: passwordInput,
  })
  .refine(confirmed, 'Passwords do not match.')
const IDLE_MS = 10 * 60_000
const GENERIC_FAILURE =
  'The account details are incorrect or access is temporarily unavailable. Try again later.'
const key = (password: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)),
    )
  })
const recoveryDigest = (code: string) =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest()
const generateRecovery = () =>
  randomBytes(32).toString('hex').toUpperCase().match(/.{8}/g)!.join('-')
interface Account extends Omit<UserAccount, 'failures' | 'locked_until'> {
  salt: Buffer
  password_hash: Buffer
  recovery_hash: Buffer | null
  session_version: number
}
interface Attempt {
  failures: number
  locked_until: number
  updated_at: number
}

/** Account credentials and audit records are independent of restorable business backups. */
export class OwnerAuth {
  private db: Database.Database
  private userId: number | null = null
  private activeShopId: string | null = null
  private sessionVersion = 0
  private lastActivity = 0
  private generation = 0
  private pending = false
  private dummySalt = randomBytes(32)
  private dummyHash = randomBytes(64)
  private operationWindow = 0
  private operationCount = 0
  private rateNotice = -Infinity
  constructor(
    path: string,
    private changed: (state: AuthState) => void = () => {},
    private now: () => number = Date.now,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = FULL')
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('trusted_schema = OFF')
    this.db.pragma('foreign_keys = ON')
    const version = this.db.pragma('user_version', { simple: true }) as number
    if (version > 3) {
      this.db.close()
      throw new Error('This account database requires a newer DormStore version.')
    }
    if (version < 2) this.migrate()
    if (version < 3) this.migrateShops()
  }
  private migrateShops() {
    this.db.transaction(() => {
      this.db
        .exec(`CREATE TABLE shops(id TEXT PRIMARY KEY,name TEXT NOT NULL,owner_id INTEGER NOT NULL REFERENCES accounts(id),legacy INTEGER NOT NULL DEFAULT 0 CHECK(legacy IN (0,1)));
        CREATE UNIQUE INDEX one_legacy_shop ON shops(legacy) WHERE legacy=1;
        ALTER TABLE accounts ADD COLUMN shop_id TEXT REFERENCES shops(id);
        ALTER TABLE security_events ADD COLUMN shop_id TEXT REFERENCES shops(id);
        CREATE INDEX security_events_shop ON security_events(shop_id,id);`)
      const owners = this.db
        .prepare("SELECT * FROM accounts WHERE role='owner' ORDER BY active DESC,id")
        .all() as Account[]
      const legacyOwner = owners.find((a) => a.active)
      if (!legacyOwner && this.configured())
        throw new Error('An active owner is required to migrate the existing store.')
      for (const owner of owners) {
        const id = randomUUID(),
          legacy = owner.id === legacyOwner?.id ? 1 : 0
        this.db
          .prepare('INSERT INTO shops VALUES (?,?,?,?)')
          .run(
            id,
            legacy ? 'DormStore' : `${owner.display_name}’s shop`.slice(0, 120),
            owner.id,
            legacy,
          )
        this.db.prepare('UPDATE accounts SET shop_id=? WHERE id=?').run(id, owner.id)
      }
      if (legacyOwner) {
        const primary = this.account(legacyOwner.id)!.shop_id
        this.db.prepare("UPDATE accounts SET shop_id=? WHERE role='staff'").run(primary)
        this.db.prepare('UPDATE security_events SET shop_id=?').run(primary)
      }
      this.db.pragma('user_version = 3')
    })()
  }
  private shop(id: string) {
    return this.db.prepare('SELECT * FROM shops WHERE id=?').get(id) as Shop | undefined
  }
  private canUseShop(user: Account, id: string | null) {
    if (!id) return false
    const shop = this.shop(id)
    return !!shop && (user.role === 'owner' ? shop.owner_id === user.id : user.shop_id === shop.id)
  }
  currentShop(): Shop {
    const user = this.currentUser()
    if (!this.canUseShop(user, this.activeShopId))
      throw new Error('Your account does not have access to this shop.')
    return this.shop(this.activeShopId!)!
  }
  listShops(): Shop[] {
    const user = this.currentUser()
    return user.role === 'owner'
      ? (this.db
          .prepare('SELECT * FROM shops WHERE owner_id=? ORDER BY legacy DESC,rowid')
          .all(user.id) as Shop[])
      : [this.currentShop()]
  }
  switchShop(input: unknown): AuthState {
    const user = this.owner(),
      id = z.string().uuid().parse(input)
    if (!this.canUseShop(user, id))
      throw new Error('Your account does not have access to this shop.')
    if (id !== this.activeShopId) {
      this.generation++
      this.activeShopId = id
      this.lastActivity = this.now()
      this.record('shop.switched', id)
      this.changed(this.rawState())
    }
    return this.rawState()
  }
  async createShop(input: unknown): Promise<Shop> {
    const user = this.owner()
    this.throttle()
    const data = z
      .object({ name: z.string().trim().min(1).max(120), currentPassword: passwordInput })
      .parse(input)
    return this.exclusive(async (generation) => {
      await this.verifyCurrent(data.currentPassword, generation)
      this.owner()
      if (this.listShops().length >= 50)
        throw new Error('The limit of 50 shops per owner has been reached.')
      const id = randomUUID()
      this.db.prepare('INSERT INTO shops VALUES (?,?,?,0)').run(id, data.name, user.id)
      this.record('shop.created', id, '', user.username, id)
      return this.shop(id)!
    })
  }
  renameCurrentShop(name: string) {
    this.owner()
    const shop = this.currentShop()
    const value = z.string().trim().min(1).max(120).parse(name)
    if (shop.name !== value) {
      this.db.prepare('UPDATE shops SET name=? WHERE id=?').run(value, shop.id)
      this.changed(this.rawState())
    }
  }
  private migrate() {
    this.db.transaction(() => {
      this.db.exec(`CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE, display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner','staff')), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)),
        salt BLOB NOT NULL, password_hash BLOB NOT NULL, recovery_hash BLOB,
        session_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS login_attempts(username TEXT PRIMARY KEY,failures INTEGER NOT NULL,locked_until INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_requests(id INTEGER PRIMARY KEY,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS auth_requests_date ON auth_requests(created_at);
      CREATE TABLE IF NOT EXISTS security_events(id INTEGER PRIMARY KEY,actor TEXT,action TEXT NOT NULL,target TEXT,details TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_account(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL UNIQUE,salt BLOB NOT NULL,password_hash BLOB NOT NULL,recovery_hash BLOB NOT NULL,failures INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0);`)
      const old = this.db.prepare('SELECT * FROM owner_account WHERE id=1').get() as
        (Account & Attempt) | undefined
      const count = (this.db.prepare('SELECT COUNT(*) n FROM accounts').get() as { n: number }).n
      if (old && !count) {
        this.db
          .prepare(
            "INSERT INTO accounts(id,username,display_name,role,salt,password_hash,recovery_hash) VALUES (1,?,?,'owner',?,?,?)",
          )
          .run(old.username, old.username, old.salt, old.password_hash, old.recovery_hash)
        if (old.failures)
          this.db
            .prepare('INSERT INTO login_attempts VALUES (?,?,?,?)')
            .run(old.username, old.failures, old.locked_until, this.now())
      }
      // Prevent older 1.1 builds from offering fresh-owner setup against this upgraded file.
      this.db
        .prepare('INSERT OR REPLACE INTO owner_account VALUES (1,?,?,?,?,0,0)')
        .run(
          `upgrade-required-${randomBytes(8).toString('hex')}`,
          randomBytes(32),
          randomBytes(64),
          randomBytes(32),
        )
      this.db.pragma('user_version = 2')
    })()
  }
  private account(id: number) {
    return this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as Account | undefined
  }
  private byName(name: string) {
    return this.db.prepare('SELECT * FROM accounts WHERE username=?').get(name) as
      Account | undefined
  }
  private configured() {
    return !!this.db.prepare('SELECT id FROM accounts LIMIT 1').get()
  }
  private attempt(name: string): Attempt | undefined {
    return this.db.prepare('SELECT * FROM login_attempts WHERE username=?').get(name) as
      Attempt | undefined
  }
  private globalUntil() {
    const row = this.db
      .prepare('SELECT COUNT(*) n, MIN(created_at) first FROM auth_requests WHERE created_at>?')
      .get(this.now() - 60_000) as { n: number; first: number | null }
    return row.n >= 20 && row.first !== null ? row.first + 60_000 : 0
  }
  private rawState(): AuthState {
    const account = this.userId === null ? undefined : this.account(this.userId)
    const authenticated =
      !!account?.active &&
      account.session_version === this.sessionVersion &&
      this.canUseShop(account, this.activeShopId)
    const shop = authenticated ? this.shop(this.activeShopId!)! : undefined
    return {
      configured: this.configured(),
      authenticated,
      username: authenticated ? account.username : null,
      userId: authenticated ? account.id : null,
      role: authenticated ? account.role : null,
      displayName: authenticated ? account.display_name : null,
      mustChangePassword: authenticated ? !!account.must_change_password : false,
      lockedUntil: this.globalUntil(),
      idleMinutes: IDLE_MS / 60_000,
      shopId: shop?.id || null,
      shopName: shop?.name || null,
    }
  }
  status() {
    if (
      this.userId !== null &&
      (this.now() - this.lastActivity >= IDLE_MS || !this.rawState().authenticated)
    )
      this.lock()
    return this.rawState()
  }
  requireSession(expectedGeneration?: number) {
    if (
      !this.status().authenticated ||
      (expectedGeneration !== undefined && expectedGeneration !== this.generation)
    )
      throw new Error('Your store is locked. Sign in to continue.')
    return this.generation
  }
  currentUser() {
    this.requireSession()
    return this.account(this.userId!)!
  }
  authorize(action: string, expectedGeneration?: number) {
    const generation = this.requireSession(expectedGeneration),
      user = this.currentUser()
    if (this.now() - this.operationWindow >= 10_000) {
      this.operationWindow = this.now()
      this.operationCount = 0
    }
    if (++this.operationCount > 120)
      throw new Error('Too many store requests. Wait a few seconds and try again.')
    if (!ownerOperations.has(action) || (user.role !== 'owner' && !staffOperations.has(action))) {
      this.record('access.denied', action, '', user.username)
      throw new Error('Your account does not have permission for this action.')
    }
    if (user.must_change_password && action !== 'auth:change-password')
      throw new Error('Change your temporary password before accessing the store.')
    return generation
  }
  activity() {
    this.requireSession()
    this.lastActivity = this.now()
    return this.rawState()
  }
  lock() {
    const user = this.userId === null ? undefined : this.account(this.userId)
    const shopId = this.activeShopId
    this.generation++
    this.userId = null
    this.activeShopId = null
    this.lastActivity = 0
    if (user) this.record('session.locked', user.username, '', user.username, shopId)
    const state = this.rawState()
    this.changed(state)
    return state
  }
  private openSession(account: Account) {
    this.generation++
    this.userId = account.id
    this.activeShopId = account.shop_id
    this.sessionVersion = account.session_version
    this.lastActivity = this.now()
    this.db.prepare('DELETE FROM login_attempts WHERE username=?').run(account.username)
    this.record('sign_in.succeeded', account.username, '', account.username)
    return this.rawState()
  }
  record(
    action: string,
    target: string | null = null,
    details = '',
    actor?: string | null,
    shopId?: string | null,
  ) {
    const name =
      actor === undefined
        ? this.userId === null
          ? null
          : this.account(this.userId)?.username || null
        : actor
    const scope =
      shopId === undefined
        ? this.activeShopId ||
          (name ? this.byName(name)?.shop_id : null) ||
          (target ? this.byName(target)?.shop_id : null) ||
          null
        : shopId
    this.db
      .prepare(
        'INSERT INTO security_events(actor,action,target,details,created_at,shop_id) VALUES (?,?,?,?,?,?)',
      )
      .run(name, action, target, details, this.now(), scope)
    this.db
      .prepare(
        'DELETE FROM security_events WHERE shop_id IS ? AND id IN (SELECT id FROM security_events WHERE shop_id IS ? ORDER BY id DESC LIMIT -1 OFFSET 5000)',
      )
      .run(scope, scope)
  }
  private throttle() {
    this.db.prepare('DELETE FROM auth_requests WHERE created_at<=?').run(this.now() - 60_000)
    this.db
      .prepare('DELETE FROM login_attempts WHERE updated_at<? AND locked_until<=?')
      .run(this.now() - 86400000, this.now())
    const until = this.globalUntil()
    if (until > this.now()) {
      if (this.now() - this.rateNotice >= 60_000) {
        this.record('auth.rate_limited')
        this.rateNotice = this.now()
      }
      throw new Error(
        `Too many authentication requests. Try again in ${Math.ceil((until - this.now()) / 1000)} seconds.`,
      )
    }
    this.db.prepare('INSERT INTO auth_requests(created_at) VALUES (?)').run(this.now())
  }
  private checkCooldown(name: string) {
    if ((this.attempt(name)?.locked_until || 0) > this.now()) throw new Error(GENERIC_FAILURE)
  }
  private fail(name: string): never {
    const failures = (this.attempt(name)?.failures || 0) + 1
    const delay = failures >= 5 ? Math.min(15 * 60_000, 60_000 * 2 ** Math.min(failures - 5, 4)) : 0
    this.db
      .prepare(
        'INSERT INTO login_attempts VALUES (?,?,?,?) ON CONFLICT(username) DO UPDATE SET failures=excluded.failures,locked_until=excluded.locked_until,updated_at=excluded.updated_at',
      )
      .run(name, failures, delay ? this.now() + delay : 0, this.now())
    this.record(delay ? 'account.cooldown' : 'sign_in.failed', name)
    throw new Error(GENERIC_FAILURE)
  }
  private async exclusive<T>(work: (generation: number) => Promise<T>) {
    if (this.pending) throw new Error('An account operation is already in progress.')
    this.pending = true
    try {
      return await work(this.generation)
    } finally {
      this.pending = false
    }
  }
  private unchanged(generation: number) {
    if (generation !== this.generation)
      throw new Error('The store was locked during this request. Please try again.')
  }
  private owner() {
    const user = this.currentUser()
    if (user.role !== 'owner' || user.must_change_password)
      throw new Error('Only an owner can manage accounts and security records.')
    return user
  }
  private async verifyCurrent(password: string, generation: number) {
    const user = this.currentUser()
    this.checkCooldown(user.username)
    const candidate = await key(password, user.salt)
    this.requireSession(generation)
    if (!timingSafeEqual(candidate, user.password_hash)) this.fail(user.username)
    this.db.prepare('DELETE FROM login_attempts WHERE username=?').run(user.username)
    return user
  }
  async setup(input: unknown): Promise<AuthAccess> {
    this.throttle()
    const data = setupSchema.parse(input)
    return this.exclusive(async (generation) => {
      if (this.configured()) throw new Error('An owner account already exists. Sign in instead.')
      return this.newOwner(data, generation, true)
    })
  }
  async registerOwner(input: unknown): Promise<AuthAccess> {
    this.throttle()
    const data = setupSchema.parse(input)
    if (!data.shopName) throw new Error('Enter the name of your new shop.')
    return this.exclusive(async (generation) => {
      if (this.userId !== null)
        throw new Error('Lock the current account before registering another owner.')
      if (this.byName(data.username))
        throw new Error('That username is already in use. Choose another username.')
      return this.newOwner(data, generation, !this.configured())
    })
  }
  private async newOwner(
    data: z.infer<typeof setupSchema>,
    generation: number,
    legacy: boolean,
  ): Promise<AuthAccess> {
    const salt = randomBytes(32),
      hash = await key(data.password, salt),
      recoveryCode = generateRecovery()
    this.unchanged(generation)
    const id = this.db.transaction(() => {
      const result = this.db
        .prepare(
          "INSERT INTO accounts(username,display_name,role,salt,password_hash,recovery_hash) VALUES (?,?,'owner',?,?,?)",
        )
        .run(data.username, data.username, salt, hash, recoveryDigest(recoveryCode))
      const owner = Number(result.lastInsertRowid),
        shopId = randomUUID()
      this.db
        .prepare('INSERT INTO shops VALUES (?,?,?,?)')
        .run(shopId, data.shopName || 'DormStore', owner, Number(legacy))
      this.db.prepare('UPDATE accounts SET shop_id=? WHERE id=?').run(shopId, owner)
      return owner
    })()
    this.record('account.owner_created', data.username, '', data.username)
    return { state: this.openSession(this.account(id)!), recoveryCode }
  }
  async signIn(input: unknown): Promise<AuthAccess> {
    this.throttle()
    const data = signInSchema.parse(input)
    return this.exclusive(async (generation) => {
      if (this.userId !== null)
        throw new Error('Lock the current account before signing in to another account.')
      if (!this.configured()) throw new Error('Create your owner account first.')
      this.checkCooldown(data.username)
      const user = this.byName(data.username),
        candidate = await key(data.password, user?.salt || this.dummySalt)
      this.unchanged(generation)
      const matches = timingSafeEqual(candidate, user?.password_hash || this.dummyHash)
      if (!user?.active || !matches) this.fail(data.username)
      return { state: this.openSession(user) }
    })
  }
  async changePassword(input: unknown): Promise<AuthAccess> {
    this.throttle()
    const data = changeSchema.parse(input)
    return this.exclusive(async (generation) => {
      this.requireSession(generation)
      const user = await this.verifyCurrent(data.currentPassword, generation)
      const salt = randomBytes(32),
        hash = await key(data.password, salt),
        recoveryCode =
          user.must_change_password || !user.recovery_hash ? generateRecovery() : undefined
      this.requireSession(generation)
      this.db
        .prepare(
          'UPDATE accounts SET salt=?,password_hash=?,must_change_password=0,recovery_hash=?,session_version=session_version+1 WHERE id=?',
        )
        .run(salt, hash, recoveryCode ? recoveryDigest(recoveryCode) : user.recovery_hash, user.id)
      this.sessionVersion++
      this.lastActivity = this.now()
      this.record('password.changed', user.username)
      return { state: this.rawState(), recoveryCode }
    })
  }
  async resetPassword(input: unknown): Promise<AuthAccess> {
    this.throttle()
    const data = resetSchema.parse(input)
    return this.exclusive(async (generation) => {
      if (this.userId !== null)
        throw new Error('Lock the current account before recovering an account.')
      this.checkCooldown(data.username)
      const user = this.byName(data.username),
        matches = timingSafeEqual(
          recoveryDigest(data.recoveryCode),
          user?.recovery_hash || Buffer.alloc(32),
        )
      if (!user?.active || !user.recovery_hash || !matches) this.fail(data.username)
      const salt = randomBytes(32),
        hash = await key(data.password, salt),
        recoveryCode = generateRecovery()
      this.unchanged(generation)
      this.db
        .prepare(
          'UPDATE accounts SET salt=?,password_hash=?,recovery_hash=?,must_change_password=0,session_version=session_version+1 WHERE id=?',
        )
        .run(salt, hash, recoveryDigest(recoveryCode), user.id)
      this.record('password.recovered', user.username)
      return { state: this.openSession(this.account(user.id)!), recoveryCode }
    })
  }
  listAccounts(): UserAccount[] {
    this.owner()
    const shop = this.currentShop()
    return this.db
      .prepare(
        "SELECT a.id,a.username,a.display_name,a.role,a.active,a.must_change_password,a.shop_id,COALESCE(l.failures,0) failures,COALESCE(l.locked_until,0) locked_until FROM accounts a LEFT JOIN login_attempts l ON l.username=a.username WHERE a.id=? OR (a.role='staff' AND a.shop_id=?) ORDER BY a.id",
      )
      .all(shop.owner_id, shop.id) as UserAccount[]
  }
  securityEvents(): SecurityEvent[] {
    this.owner()
    return this.db
      .prepare('SELECT * FROM security_events WHERE shop_id=? ORDER BY id DESC LIMIT 300')
      .all(this.currentShop().id) as SecurityEvent[]
  }
  async createAccount(input: unknown) {
    this.owner()
    this.throttle()
    const data = createSchema.parse(input)
    if (data.role !== 'staff')
      throw new Error('New owners must register a separate shop from the sign-in screen.')
    return this.exclusive(async (generation) => {
      await this.verifyCurrent(data.currentPassword, generation)
      this.owner()
      if (this.byName(data.username))
        throw new Error('That username is already in use, including disabled accounts.')
      if (this.listAccounts().length >= 100)
        throw new Error('The account limit of 100 has been reached.')
      const salt = randomBytes(32),
        hash = await key(data.password, salt)
      this.requireSession(generation)
      const result = this.db
        .prepare(
          'INSERT INTO accounts(username,display_name,role,salt,password_hash,must_change_password,shop_id) VALUES (?,?,?,?,?,1,?)',
        )
        .run(data.username, data.displayName, data.role, salt, hash, this.currentShop().id)
      this.record('account.created', data.username, data.role)
      return Number(result.lastInsertRowid)
    })
  }
  async updateAccount(input: unknown) {
    this.owner()
    this.throttle()
    const data = updateSchema.parse(input)
    return this.exclusive(async (generation) => {
      const actor = await this.verifyCurrent(data.currentPassword, generation)
      this.owner()
      const target = this.account(data.id)
      if (!target || !this.listAccounts().some((account) => account.id === target.id))
        throw new Error('Account not found in this shop.')
      if (target.id === actor.id && (!data.active || data.role !== target.role))
        throw new Error('You cannot disable your own account or change your own role.')
      if (target.id !== actor.id && data.role !== 'staff')
        throw new Error(
          'Staff cannot be promoted to a separate shop owner. Register a new owner account instead.',
        )
      if (
        target.active &&
        target.role === 'owner' &&
        (!data.active || data.role !== 'owner') &&
        (
          this.db
            .prepare(
              "SELECT COUNT(*) n FROM accounts WHERE active=1 AND role='owner' AND id=(SELECT owner_id FROM shops WHERE id=?)",
            )
            .get(this.currentShop().id) as { n: number }
        ).n <= 1
      )
        throw new Error('At least one active owner must remain.')
      const invalidate = target.role !== data.role || !!target.active !== data.active
      this.db
        .prepare(
          'UPDATE accounts SET display_name=?,role=?,active=?,session_version=session_version+? WHERE id=?',
        )
        .run(data.displayName, data.role, Number(data.active), Number(invalidate), data.id)
      if (data.unlock)
        this.db.prepare('DELETE FROM login_attempts WHERE username=?').run(target.username)
      this.record(
        'account.updated',
        target.username,
        `Role: ${data.role}; ${data.active ? 'Enabled' : 'Disabled'}${data.unlock ? '; cooldown cleared' : ''}`,
      )
    })
  }
  async resetAccountPassword(input: unknown) {
    const actor = this.owner()
    this.throttle()
    const data = adminResetSchema.parse(input)
    return this.exclusive(async (generation) => {
      await this.verifyCurrent(data.currentPassword, generation)
      this.owner()
      const target = this.account(data.id)
      if (!target || !this.listAccounts().some((account) => account.id === target.id))
        throw new Error('Account not found in this shop.')
      if (target.id === actor.id) throw new Error('Use Change password for your own account.')
      const salt = randomBytes(32),
        hash = await key(data.password, salt)
      this.requireSession(generation)
      this.db
        .prepare(
          'UPDATE accounts SET salt=?,password_hash=?,recovery_hash=NULL,must_change_password=1,session_version=session_version+1 WHERE id=?',
        )
        .run(salt, hash, target.id)
      this.db.prepare('DELETE FROM login_attempts WHERE username=?').run(target.username)
      this.record('account.password_reset', target.username)
    })
  }
  close() {
    if (!this.db.open) return
    this.lock()
    this.db.close()
  }
}
