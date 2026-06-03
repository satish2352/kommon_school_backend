'use strict';

require('dotenv').config();
const { encrypt } = require('../src/utils/crypto');

const plaintext = process.argv[2];
if (!plaintext) {
  console.error('Usage: node scripts/encrypt-secret.js <plaintext>');
  process.exit(1);
}

console.log(encrypt(plaintext));
