const app = require('./src/app');
const db = require('./src/db');

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    await db.query('SELECT 1');
    console.log('Connected to Supabase Postgres.');
  } catch (err) {
    console.error('Could not connect to the database. Check DATABASE_URL in your .env file.');
    console.error(err.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Pickleball tournament app running on http://localhost:${PORT}`);
  });
})();
