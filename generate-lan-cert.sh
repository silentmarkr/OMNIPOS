#!/data/data/com.termux/files/usr/bin/bash
set -u

OPENSSL_TIMEOUT="${OPENSSL_TIMEOUT:-20}"
if command -v timeout >/dev/null 2>&1; then
    RUN_WITH_TIMEOUT() { timeout "$OPENSSL_TIMEOUT" "$@"; }
else

    RUN_WITH_TIMEOUT() { "$@"; }
fi

CERT_DIR="$(dirname "$0")/certs"
CA_KEY="$CERT_DIR/omnipos-ca-key.pem"
CA_CERT="$CERT_DIR/omnipos-ca-cert.pem"
LEAF_KEY="$CERT_DIR/omnipos-leaf-key.pem"
LEAF_CERT="$CERT_DIR/omnipos-leaf-cert.pem"
LAST_IP_FILE="$CERT_DIR/.last-lan-ip"

LAN_IP="${1:-}"
if [ -z "$LAN_IP" ]; then
    echo "❌ Kulang ang LAN IP argument. Usage: generate-lan-cert.sh <LAN_IP>" >&2
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "ℹ️  Walang openssl sa device na ito — sine-skip ang LAN HTTPS setup (babalik sa HTTP)." >&2
    exit 1
fi

mkdir -p "$CERT_DIR"

if [ ! -f "$CA_KEY" ] || [ ! -f "$CA_CERT" ]; then
    echo "🔑 Gumagawa ng bagong lokal na OmniPOS LAN CA (isang beses lang ito)..."
    RUN_WITH_TIMEOUT openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
        -keyout "$CA_KEY" -out "$CA_CERT" \
        -subj "/CN=OmniPOS LAN Local CA" \
        -addext "basicConstraints=critical,CA:TRUE" \
        -addext "keyUsage=critical,keyCertSign,cRLSign" \
        >/dev/null 2>&1
    CA_RESULT=$?
    if [ "$CA_RESULT" -eq 124 ]; then
        echo "❌ Nag-timeout ang paggawa ng CA (mahigit ${OPENSSL_TIMEOUT}s) — babalik sa plain HTTP." >&2
        rm -f "$CA_KEY" "$CA_CERT"
        exit 1
    elif [ "$CA_RESULT" -ne 0 ] || [ ! -f "$CA_CERT" ]; then
        echo "❌ Nabigo ang paggawa ng CA — babalik sa plain HTTP." >&2
        exit 1
    fi
    chmod 600 "$CA_KEY"
fi

LAST_IP="$(cat "$LAST_IP_FILE" 2>/dev/null || echo '')"

if [ ! -f "$LEAF_CERT" ] || [ ! -f "$LEAF_KEY" ] || [ "$LAST_IP" != "$LAN_IP" ]; then
    echo "🔐 Gumagawa ng LAN HTTPS certificate para sa $LAN_IP..."

    LEAF_CSR="$CERT_DIR/.leaf.csr"
    EXT_FILE="$CERT_DIR/.leaf-ext.cnf"

    cat > "$EXT_FILE" <<EOF
subjectAltName = @alt_names
extendedKeyUsage = serverAuth
[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
IP.2 = ${LAN_IP}
EOF

    RUN_WITH_TIMEOUT openssl req -new -newkey rsa:2048 -sha256 -nodes \
        -keyout "$LEAF_KEY" -out "$LEAF_CSR" \
        -subj "/CN=${LAN_IP}" >/dev/null 2>&1
    CSR_RESULT=$?

    RESULT=1
    if [ "$CSR_RESULT" -eq 0 ]; then
        RUN_WITH_TIMEOUT openssl x509 -req -in "$LEAF_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" \
            -CAcreateserial -days 825 -sha256 \
            -extfile "$EXT_FILE" \
            -out "$LEAF_CERT" >/dev/null 2>&1
        RESULT=$?
    fi

    rm -f "$LEAF_CSR" "$EXT_FILE" "$CERT_DIR"/*.srl 2>/dev/null

    if [ "$CSR_RESULT" -eq 124 ] || [ "$RESULT" -eq 124 ]; then
        echo "❌ Nag-timeout ang paggawa ng LAN certificate (mahigit ${OPENSSL_TIMEOUT}s) — babalik sa plain HTTP." >&2
        rm -f "$LEAF_KEY" "$LEAF_CERT"
        exit 1
    elif [ "$CSR_RESULT" -ne 0 ] || [ "$RESULT" -ne 0 ] || [ ! -f "$LEAF_CERT" ]; then
        echo "❌ Nabigo ang paggawa ng LAN certificate — babalik sa plain HTTP." >&2
        exit 1
    fi

    chmod 600 "$LEAF_KEY"
    echo "$LAN_IP" > "$LAST_IP_FILE"
    echo "✅ LAN HTTPS certificate ready para sa $LAN_IP"
else
    echo "✅ Gagamitin ang existing LAN HTTPS certificate (IP $LAN_IP, walang pagbabago)."
fi

exit 0
