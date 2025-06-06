import { verify } from 'hono/jwt'

export const authMiddleware = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Token missing' }, 401)
  }

  const token = authHeader.split(' ')[1]

  try {
    const payload = await verify(token, c.env.JWT_SECRET)
    c.set('user', payload) // Token payload jaise gr_number yahan se access hoga
    await next()
  } catch (err) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }
}
