import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import { sign, verify } from 'hono/jwt'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('*', cors())

// Test API
app.get('/api/hello', (c) => {
  return c.text('Hello from Placement Portal Backend!')
})

// Register API
app.post('/api/register', async (c) => {
  const body = await c.req.json()
  const { gr_no, name, email, password, address } = body

  if (!gr_no || !name || !email || !password) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10)

    await c.env.DB.prepare(
      `INSERT INTO users (gr_no, name, email, password, address) VALUES (?, ?, ?, ?, ?)`
    ).bind(gr_no, name, email, hashedPassword, address).run()

    return c.json({ message: 'User registered successfully' })
  } catch (err) {
    console.error(err)
    return c.json({ error: 'Registration failed', details: err.message }, 500)
  }
})

// Login API
app.post('/api/login', async (c) => {
  const body = await c.req.json()
  const { gr_no, password } = body

  if (!gr_no || !password) {
    return c.json({ error: 'Missing GR No. or Password' }, 400)
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM users WHERE gr_no = ?`
    ).bind(gr_no).all()

    const user = results[0]

    if (!user) {
      return c.json({ error: 'Invalid GR No.' }, 401)
    }

    const passwordMatch = await bcrypt.compare(password, user.password)

    if (!passwordMatch) {
      return c.json({ error: 'Invalid Password' }, 401)
    }

    const token = await sign(
      { gr_no: user.gr_no, email: user.email },
      'SECRET_KEY'
    )

    return c.json({ message: 'Login successful', token })
  } catch (err) {
    console.error(err)
    return c.json({ error: 'Login failed', details: err.message }, 500)
  }
})

// Upload API
app.post('/api/upload', async (c) => {
  const formData = await c.req.parseBody()

  const gr_no = formData['gr_no']
  const profile = formData['profile']
  const cv = formData['cv']

  if (!gr_no || !profile || !cv) {
    return c.json({ error: 'GR No, profile photo, and CV are required.' }, 400)
  }

  try {
    const timestamp = Date.now()
    const profileKey = `profile-${timestamp}-${profile.name}`
    const cvKey = `cv-${timestamp}-${cv.name}`

    await c.env.R2_BUCKET.put(profileKey, profile, {
      httpMetadata: { contentType: profile.type }
    })

    await c.env.R2_BUCKET.put(cvKey, cv, {
      httpMetadata: { contentType: cv.type }
    })

    const baseUrl = 'https://placement-portal-backend.ramshekade20.workers.dev'

    const profileUrl = `${baseUrl}/media/profile/${timestamp}-${profile.name}`
    const cvUrl = `${baseUrl}/media/cv/${timestamp}-${cv.name}`


    await c.env.DB.prepare(`
      UPDATE users 
      SET profile_photo_url = ?, cv_url = ?
      WHERE gr_no = ?                
    `).bind(profileUrl, cvUrl, gr_no).run()

    return c.json({
      message: 'Files uploaded and user record updated successfully',
      profile_photo_url: profileUrl,
      cv_url: cvUrl
    })
  } catch (err) {
    console.error(err)
    return c.json({ error: 'Upload failed', details: err.message }, 500)
  }
})

// Update profile API
app.put('/api/profile/update', async (c) => {
  const body = await c.req.json()
  const { gr_no, name, email, address } = body

  if (!gr_no || !name || !email) {
    return c.json({ error: 'Missing required fields' }, 400)
  }

  try {
    await c.env.DB.prepare(
      `UPDATE users SET name = ?, email = ?, address = ? WHERE gr_no = ?`
    ).bind(name, email, address, gr_no).run()

    return c.json({ message: 'Profile updated successfully' })
  } catch (err) {
    console.error(err)
    return c.json({ error: 'Failed to update profile', details: err.message }, 500)
  }
})

// Get profile
app.get('/api/profile', async (c) => {
  const gr_no = c.req.query('gr_no')

  if (!gr_no) {
    return c.json({ error: 'GR No. is required' }, 400)
  }

  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id, gr_no, name, email, address, profile_photo_url, cv_url FROM users WHERE gr_no = ?`
    ).bind(gr_no).all()

    const user = results[0]

    if (!user) {
      return c.json({ error: 'User not found' }, 404)
    }

    return c.json({ user })
  } catch (err) {
    console.error(err)
    return c.json({ error: 'Failed to fetch profile', details: err.message }, 500)
  }
})

// Serve R2 file publicly via Worker route
app.get('/media/:type/:filename', async (c) => {
  const { type, filename } = c.req.param()
  const key = `${type}-${filename}`

  const object = await c.env.R2_BUCKET.get(key)
  if (!object) return c.notFound()

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream'
    }
  })
})

export default app
