import { Hono } from 'hono'
import { authMiddleware } from '../middleware/Authenticate';

const student = new Hono()

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

student.use('*', authMiddleware)

student.post('/profile/create', async (c) => {
  try {
    const user = c.get('user'); // assuming this gives user object
    const user_id = user.gr_number;
    const db = c.env.DB;
    const bucket = c.env.R2_BUCKET;

    const formData = await c.req.parseBody();

    // Helper to parse JSON fields safely (if string, parse; else default to '[]')
    const parseJSONField = (field) => {
      if (!field) return '[]';
      if (typeof field === 'string') {
        try {
          return JSON.stringify(JSON.parse(field));
        } catch {
          // if invalid JSON string, just return as stringified anyway
          return JSON.stringify(field);
        }
      }
      // if already object/array, stringify
      return JSON.stringify(field);
    };

    const baseUrl = 'https://placement-portal-backend.ramshekade20.workers.dev'
    // Upload file to R2 bucket and return URL
    const uploadToR2 = async (file, type) => {
      if (!file || !(file instanceof File)) return null;
      const ext = file.name.split('.').pop();
      const key = `${type}/${user_id}_${uuidv4()}.${ext}`;
      await bucket.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type },
      });
      return `${baseUrl}/${key}`;
    };

    // Upload files (if any)
    const profile_url = await uploadToR2(formData['profile_photo'], 'profile');
    const resume_url = await uploadToR2(formData['resume'], 'resume');
    const ssc_url = await uploadToR2(formData['ssc_marksheet'], 'ssc');
    const hsc_url = await uploadToR2(formData['hsc_marksheet'], 'hsc');
    const diploma_url = await uploadToR2(formData['diploma_marksheet'], 'diploma');

    // Prepare SQL statement (40 columns as per your table)
    const stmt = db.prepare(`
      INSERT INTO student_profiles (
        profile_url, first_name, middle_name, last_name, gender,
        date_of_birth, contact_number_primary, contact_number_alternate,
        email, aadhaar_number, pan_number, student_id,
        current_year, department, year_of_admission, expected_graduation_year,
        ssc_percentage, ssc_year, ssc_marksheet_url,
        hsc_percentage, hsc_year, hsc_marksheet_url,
        diploma_percentage, diploma_year, diploma_marksheet_url,
        sem1_cgpa, sem2_cgpa, sem3_cgpa, sem4_cgpa, sem5_cgpa,
        sem6_cgpa, sem7_cgpa, sem8_cgpa,
        programming_languages, soft_skills, certifications, projects,
        achievements, internships, resume_url
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    // Bind values - converting types and handling nulls correctly
    await stmt.bind(
      profile_url || null,
      formData.first_name,
      formData.middle_name || null,
      formData.last_name,
      formData.gender,
      formData.date_of_birth,
      formData.contact_number_primary,
      formData.contact_number_alternate || null,
      formData.email,
      formData.aadhaar_number,
      formData.pan_number || null,
      formData.student_id || formData.student_id_number, // accommodate either key
      Number(formData.current_year),
      formData.department,
      Number(formData.year_of_admission),
      Number(formData.expected_graduation_year),
      formData.ssc_percentage,
      Number(formData.ssc_year),
      ssc_url || null,
      formData.hsc_percentage || null,
      formData.hsc_year ? Number(formData.hsc_year) : null,
      hsc_url || null,
      formData.diploma_percentage || null,
      formData.diploma_year ? Number(formData.diploma_year) : null,
      diploma_url || null,
      formData.sem1_cgpa ? Number(formData.sem1_cgpa) : null,
      formData.sem2_cgpa ? Number(formData.sem2_cgpa) : null,
      formData.sem3_cgpa ? Number(formData.sem3_cgpa) : null,
      formData.sem4_cgpa ? Number(formData.sem4_cgpa) : null,
      formData.sem5_cgpa ? Number(formData.sem5_cgpa) : null,
      formData.sem6_cgpa ? Number(formData.sem6_cgpa) : null,
      formData.sem7_cgpa ? Number(formData.sem7_cgpa) : null,
      formData.sem8_cgpa ? Number(formData.sem8_cgpa) : null,

      parseJSONField(formData.programming_languages),
      parseJSONField(formData.soft_skills),
      parseJSONField(formData.certifications),
      parseJSONField(formData.projects),
      parseJSONField(formData.achievements),
      parseJSONField(formData.internships),
      resume_url || null
    ).run();

    return c.json({ success: true, message: '✅ Full profile created successfully!' });
  } catch (err) {
    console.error('❌ Profile creation failed:', err);
    return c.json({ error: '❌ Failed to create profile', details: err.message }, 500);
  }
});



// Upload profile picture route
student.post('/upload', async (c) => {
  try {
    const user = c.get('user');
    const gr_number = user.gr_number;
    const db = c.env.DB;
    const bucket = c.env.R2_BUCKET;

    const body = await c.req.parseBody();
    const file = body['profile'];

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file uploaded or invalid format' }, 400);
    }

    const fileExt = file.name.split('.').pop();
    const key = `profile/${gr_number}_${uuidv4()}.${fileExt}`;

    await bucket.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });

    const imageUrl = `https://${c.env.R2_BUCKET}.r2.cloudflarestorage.com/${key}`;

    await db
      .prepare('UPDATE students_login SET profile_pic = ? WHERE gr_number = ?')
      .bind(imageUrl, gr_number)
      .run();

    return c.json({ message: '✅ Profile picture uploaded successfully!', imageUrl });
  } catch (err) {
    console.error('Upload failed:', err);
    return c.json({ error: 'Internal Server Error', details: err.message }, 500);
  }
});


// Sample Worker route to serve R2 objects publicly
student.get('/profile/:filename', async (c) => {
  const bucket = c.env.R2_BUCKET;
  const filename = c.req.param('filename'); // or however you get route param

  try {
    const object = await bucket.get(`profile/${filename}`);
    if (!object) {
      return c.json({ error: "File not found" }, 404);
    }

    const body = object.body; // ReadableStream
    const contentType = object.httpMetadata?.contentType || 'application/octet-stream';

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000', // optional cache
      }
    });
  } catch (err) {
    return c.json({ error: "Error fetching file", details: err.message }, 500);
  }
});


export default student
