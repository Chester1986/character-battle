const selfsigned = require('selfsigned');
const fs = require('fs');

console.log('Generating SSL certificate...');

const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365 });

fs.writeFileSync('cert.pem', pems.cert, { encoding: 'utf-8' });
fs.writeFileSync('key.pem', pems.private, { encoding: 'utf-8' });

console.log('Certificate generated successfully: cert.pem, key.pem');
