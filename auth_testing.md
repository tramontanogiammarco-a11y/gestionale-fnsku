# Auth Testing

## Credenziali
- Admin: admin@prepcenter.it / Admin123!
- Cliente demo: cliente@demo.it / Cliente123!

## Note
- Auth via cookie httpOnly (access_token, refresh_token). Frontend usa withCredentials.
- Endpoints: POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout, POST /api/auth/refresh
- Ruoli: admin, staff (come admin), cliente (solo propri dati).
- get_current_user legge cookie o Authorization Bearer.

## Verifica rapida
curl -c c.txt -X POST $URL/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@prepcenter.it","password":"Admin123!"}'
curl -b c.txt $URL/api/auth/me
