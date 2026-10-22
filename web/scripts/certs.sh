#!/bin/sh
# Certificates for https://localhost in web/certs/: mkcert when installed (trusted by the system at once),
# otherwise a local CA made with openssl whose certificate you import into your browser once.
set -eu
cd "$(dirname "$0")/../certs"
if command -v mkcert >/dev/null 2>&1; then
  mkcert -install
  mkcert -cert-file localhost.pem -key-file localhost-key.pem localhost 127.0.0.1 ::1
  exit 0
fi
if [ ! -f ca.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 -subj "/CN=ravazque.info local CA" -keyout ca-key.pem -out ca.pem 2>/dev/null
fi
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout localhost-key.pem -out localhost.csr 2>/dev/null
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\nextendedKeyUsage=serverAuth\n' > san.ext
openssl x509 -req -in localhost.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 825 -extfile san.ext -out localhost.pem 2>/dev/null
rm -f localhost.csr san.ext
chmod 644 localhost.pem localhost-key.pem
echo "Created web/certs/localhost.pem. To stop browser warnings, import web/certs/ca.pem as a trusted authority."
