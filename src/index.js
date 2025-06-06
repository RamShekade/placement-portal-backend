import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import { sign, verify } from 'hono/jwt'
import { cors } from 'hono/cors'
import students from './students.json'
import { sendCreds } from "./sendEmail"  // ✅ Correct import for named export
import auth from './student/auth'
import { authMiddleware } from './middleware/Authenticate'
import student from './student/student'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: '*', // 👈 your frontend domain
    credentials: true,
  })
);

app.use('*', async (c, next) => {
  c.env.JWT_SECRET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  c.env.signJWT = async (payload) => await sign(payload, c.env.JWT_SECRET)
  c.env.verifyJWT = async (token) => await verify(token, c.env.JWT_SECRET)
  await next()
})


// routes 
// auth route
app.route("/api/student", student )
app.route("/api/auth",(auth));

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


// create user table

app.get('/api/create-table', async (c) => {
  try {
    const db = c.env.DB

    // Create students_login table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS students_login (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        gr_number TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_updated BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `).run()

    // Create student_profiles table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS student_profiles (
      id                          INTEGER PRIMARY KEY AUTOINCREMENT,
     
      profile_url                 TEXT NOT NULL,                      -- R2 link

      -- Name details
      first_name                  TEXT NOT NULL,
      middle_name                 TEXT,                      -- Optional
      last_name                   TEXT NOT NULL,

      gender                      TEXT CHECK(gender IN ('Male', 'Female', 'Other')) NOT NULL,
      date_of_birth               DATE NOT NULL,

      -- Contact & ID
      contact_number_primary      TEXT NOT NULL,
      contact_number_alternate    TEXT,                      -- Optional
      email                       TEXT NOT NULL,
      aadhaar_number              TEXT CHECK(length(aadhaar_number) = 12), -- 12-digit only
      pan_number                  TEXT,                      -- Optional

      student_id                  TEXT CHECK(length(student_id) = 11) UNIQUE NOT NULL,

      -- Academic Info
      current_year                INTEGER NOT NULL,
      department                  TEXT NOT NULL,
      year_of_admission           INTEGER NOT NULL,
      expected_graduation_year    INTEGER NOT NULL,

      -- SSC
      ssc_percentage              TEXT NOT NULL,
      ssc_year                    INTEGER NOT NULL,
      ssc_marksheet_url           TEXT,                      -- From R2

      -- HSC or Diploma (Optional)
      hsc_percentage              TEXT,
      hsc_year                    INTEGER,
      hsc_marksheet_url           TEXT,
      diploma_percentage          TEXT,
      diploma_year                INTEGER,
      diploma_marksheet_url       TEXT,

      -- CGPA
      sem1_cgpa REAL CHECK(sem1_cgpa BETWEEN 4 AND 10),
      sem2_cgpa REAL CHECK(sem2_cgpa BETWEEN 4 AND 10),
      sem3_cgpa REAL CHECK(sem3_cgpa BETWEEN 4 AND 10),
      sem4_cgpa REAL CHECK(sem4_cgpa BETWEEN 4 AND 10),
      sem5_cgpa REAL CHECK(sem5_cgpa BETWEEN 4 AND 10),
      sem6_cgpa REAL CHECK(sem6_cgpa BETWEEN 4 AND 10),
      sem7_cgpa REAL CHECK(sem7_cgpa BETWEEN 4 AND 10),
      sem8_cgpa REAL CHECK(sem8_cgpa BETWEEN 4 AND 10),

      -- Skills & Languages
      programming_languages       TEXT,                      -- JSON array
      soft_skills                 TEXT,                      -- JSON array

      -- Certificates (Max 3)
      certifications              TEXT,                      -- JSON [{title, url}]

      -- Projects (Max 3)
      projects                    TEXT,                      -- JSON [{title, description, link}]

      -- Resume
      resume_url                  TEXT NOT NULL,                      -- R2 link
      
      -- Achievements (max 3)
      achievements             TEXT, -- JSON: [{title, description, url}]

      -- Internships (can be more than 3)
      internships              TEXT, -- JSON: [{title, type, company, duration, location, location_type, description}]


      -- Meta
      status                      TEXT CHECK(status IN ('pending','active','debarred')) DEFAULT 'pending',
      updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    `).run()

    return c.text('✅ Tables "students_login" and "student_profiles" created successfully')
  } catch (err) {
    console.error(err)
    return c.json({ error: '❌ Failed to create tables', details: err.message }, 500)
  }
})


// upload students dummy data


app.post('/api/dummydata', async (c) => {
  const students = await c.req.json(); // JSON from frontend
  const db = c.env.DB;
  let inserted = 0;
  let skipped = [];

  function generatePassword(length = 16) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  for (const row of students) {
    const gr_number = row['GR']?.toString().trim();
    const email = row['Email']?.toString().trim();
    const plainPassword = generatePassword();

    if (!gr_number || !email) continue;

    try {
      const passwordHash = await bcrypt.hash(plainPassword, 12); // bcrypt with salt

      // ✅ Insert into DB
      await db.prepare(`
        INSERT INTO students_login (gr_number, email, password_hash, password_updated)
        VALUES (?, ?, ?, 0)`
      ).bind(gr_number, email, passwordHash).run();

      // ✅ Send credentials via email (your implementation of sendCreds)
      await sendCreds(email, gr_number, plainPassword);

      inserted++;
    } catch (err) {
      console.warn(`❌ Skipping ${email}: ${err.message}`);
      skipped.push({ email, error: err.message });
    }
  }

  return c.json({
    message: `✅ Inserted ${inserted} students.`,
    skipped
  });
});


// send email for dummy registration

// app.post('/api/send-creds-batch', async (c) => {
//   const db = c.env.DB;

//   const batchSize = 25;
//   const maxSubrequests = 50;

//   let totalSent = 0;
//   let totalFailed = [];
//   let offset = 0;

//   while (true) {
//     // Fetch batch of students
//     const { results } = await db.prepare(
//       'SELECT gr_number, email, password_hash FROM students_login LIMIT ? OFFSET ?'
//     ).bind(batchSize, offset).all();

//     if (results.length === 0) break;

//     let batchSent = 0;
//     for (const student of results) {
//       try {
//         await sendCreds(student.email, student.gr_number, student.password_hash);
//         batchSent++;
//         totalSent++;
//       } catch (err) {
//         console.error(`❌ Error for ${student.email}: ${err.message}`);
//         totalFailed.push({ email: student.email, error: err.message });
//       }

//       // Avoid hitting 50 subrequest limit
//       if ((batchSent + totalFailed.length) >= maxSubrequests - 2) {
//         console.log("⏸️ Subrequest limit reached, pausing...");
//         return c.json({
//           message: `⏸️ Partial batch sent. Resume by calling this API again.`,
//           offset: offset + batchSize,
//           sentSoFar: totalSent,
//           failed: totalFailed
//         });
//       }
//     }

//     offset += batchSize;
//   }

//   return c.json({
//     message: "✅ All emails sent successfully.",
//     totalSent,
//     totalFailed
//   });

// });


export default app
