const auth = require('basic-auth');
const bcrypt = require('bcrypt');
const db = require('./db');

const getAuthUser = async (req) => {
  const credentials = auth(req);
  if (!credentials) return null;

  const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [credentials.name]);
  if (rows.length === 0) return null;

  const user = rows[0];
  const match = await bcrypt.compare(credentials.pass, user.password);
  return match ? user : null;
};

module.exports = { getAuthUser };
