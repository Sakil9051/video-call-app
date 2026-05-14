const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

let uri = 'mongodb+srv://sahillaskar137:Sakil9051@cluster0.rijokp2.mongodb.net/peerconnect';

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, 'utf8');
  const match = envFile.match(/MONGODB_URI=(.*)/);
  if (match && match[1]) {
    uri = match[1].trim().replace(/['"]/g, '');
  }
}

if (process.env.MONGODB_URI) {
  uri = process.env.MONGODB_URI;
}

console.log('🔄 Checking database connection before starting app...');

mongoose.connect(uri)
  .then(() => {
    console.log('✅ Database connected successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Database connection failed. Please check your connection string and network.');
    console.error(err.message);
    process.exit(1); // Stop the start process
  });
