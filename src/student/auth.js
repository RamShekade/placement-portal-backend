import { Hono } from 'hono'
import { jwt } from 'hono/jwt'
import bcrypt from 'bcryptjs'

// Secret key for JWT
const JWT_SECRET = 'flkgewrgneogrk439o7ggf5'

const auth = new Hono()

// 🔐 LOGIN ROUTE
auth.post('/login', async (c) => {
  const { gr_number, password } = await c.req.json()
  const db = c.env.DB

  if (!gr_number || !password) {
    return c.json({ error: 'GR Number and password are required.' }, 400)
  }

  const { results } = await db.prepare(
    'SELECT * FROM students_login WHERE gr_number = ?'
  ).bind(gr_number).all()

  if (results.length === 0) {
    return c.json({ error: 'User not found' }, 404)
  }

  const user = results[0]

  const passwordMatch = await bcrypt.compare(password, user.password_hash)
  if (!passwordMatch) {
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  const token = await c.env.signJWT({
    id: user.id,
    gr_number: user.gr_number,
    password_updated: user.password_updated,
  })

  return c.json({
    message: '✅ Login successful',
    token,
    password_updated: user.password_updated,
  })
})

// 🛡️ AUTH MIDDLEWARE
auth.use('/change-password', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader) return c.json({ error: 'Token required' }, 401)

  const token = authHeader.replace('Bearer ', '')
  try {
    const payload = await c.env.verifyJWT(token)
    c.set('user', payload)
    await next()
  } catch (err) {
    return c.json({ error: 'Invalid token' }, 401)
  }
})

// 🔁 PASSWORD UPDATE
auth.post('/change-password', async (c) => {
  const { old_password, new_password } = await c.req.json()
  const db = c.env.DB
  const user = c.get('user')

  if (!old_password || !new_password) {
    return c.json({ error: 'Both old and new password required' }, 400)
  }

  // Fetch user to verify old password
  const { results } = await db.prepare(
    'SELECT * FROM students_login WHERE id = ?'
  ).bind(user.id).all()

  const foundUser = results[0]
  const match = await bcrypt.compare(old_password, foundUser.password_hash)

  if (!match) {
    return c.json({ error: 'Old password incorrect' }, 401)
  }

  // Hash and update new password
  const newHash = await bcrypt.hash(new_password, 10)
  await db.prepare(
    `UPDATE students_login SET password_hash = ?, password_updated = 1 WHERE id = ?`
  ).bind(newHash, user.id).run()

  return c.json({ message: '✅ Password changed successfully' })
})

export default auth
