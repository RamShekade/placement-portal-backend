export const sendCreds = async (email, gr, password) => {
  const apiKey = "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" // Use environment variable in real-world!
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'TnP Portal', email: "kshitij.sharma@dmce.ac.in" },
      to: [{ email }],
      subject: 'Your Login Credentials',
      textContent: `Dear Student,

Welcome to the TnP Portal.

Your login credentials:
GR Number: ${gr}
Temporary Password: ${password}

Please change your password after first login.

Regards,
TnP Team`
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Failed to send email: ${response.status} - ${JSON.stringify(errorData)}`);
  }
};
