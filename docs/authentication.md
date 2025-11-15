# JWT Authentication Implementation

## Overview

The Teams API now includes a complete JWT-based authentication system with user registration, login, and protected routes.

## Features Implemented

✅ **User Registration** - Create new user accounts with email, username, and password  
✅ **User Login** - Authenticate with email/username and password to receive JWT token  
✅ **Password Hashing** - Secure password storage using bcrypt (10 salt rounds)  
✅ **JWT Token Generation** - Stateless authentication with configurable expiration  
✅ **Protected Routes** - Middleware to verify JWT tokens on protected endpoints  
✅ **CORS Enabled** - Cross-origin requests supported for frontend integration  
✅ **MongoDB Storage** - User data stored in MongoDB with unique email/username indexes  

## API Endpoints

### Authentication Routes

#### Register New User
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (201 Created):**
```json
{
  "user": {
    "id": "1",
    "email": "user@example.com",
    "createdAt": "2025-11-15T10:30:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "1",
    "email": "user@example.com",
    "createdAt": "2025-11-15T10:30:00.000Z"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Get Current User Info (Protected)
```http
GET /api/auth/me
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{
  "id": "1",
  "email": "user@example.com",
  "createdAt": "2025-11-15T10:30:00.000Z",
  "updatedAt": "2025-11-15T10:30:00.000Z"
}
```

## Environment Variables

Add these to your `.env` file:

```bash
# JWT Authentication Configuration
JWT_SECRET=your-secret-key-change-this-in-production
JWT_EXPIRATION=24h
```

### Generate a Secure Secret

For production, generate a strong random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Validation Rules

### Email
- Valid email format required
- Stored in lowercase
- Must be unique

### Password
- Minimum 6 characters
- Hashed using bcrypt before storage

## Using Protected Routes

To access protected routes, include the JWT token in the Authorization header:

```javascript
fetch('http://localhost:3000/api/auth/me', {
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
})
```

## Authentication Middleware

Two middleware functions are available:

### `authenticateToken`
- Requires valid JWT token
- Returns 401 if token missing
- Returns 403 if token invalid/expired
- Adds `user` object to request

### `optionalAuth`
- Does not fail if no token provided
- Validates token if present
- Adds `user` object to request if token valid

## Example Usage in Controllers

```typescript
import { authenticateToken, AuthRequest } from '../middleware/auth';

// Protected route
router.get('/profile', authenticateToken, async (req: AuthRequest, res) => {
  const userId = req.user?.id; // User info available from token
  // ... handle request
});
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "Email and password are required"
}
```

### 401 Unauthorized
```json
{
  "error": "Invalid credentials"
}
```

### 403 Forbidden
```json
{
  "error": "Invalid or expired token"
}
```

### 409 Conflict
```json
{
  "error": "Email already registered"
}
```

## Security Features

- **Password Hashing**: bcrypt with 10 salt rounds
- **JWT Expiration**: Configurable token lifetime (default: 24h)
- **Unique Constraints**: Email uniqueness enforced at database level
- **Input Validation**: Email format and password strength
- **Lowercase Storage**: Emails stored in lowercase for case-insensitive matching
- **Token Verification**: Stateless authentication with JWT signature verification

## Database Schema

### Users Collection

```typescript
{
  _id: string;           // Auto-generated sequence ID
  email: string;         // Unique, lowercase
  password: string;      // bcrypt hashed
  createdAt: Date;
  updatedAt: Date;
}
```

### Indexes

- `email` - Unique index
- `createdAt` - Descending index for recent users

## Testing the Authentication

### 1. Register a new user
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 2. Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

### 3. Get current user (use token from login response)
```bash
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Password Reset (Forgot Password)

The API supports a secure password reset flow. The flow:

1. Client calls `POST /api/auth/request-reset` with the user's email.
2. Server generates a cryptographically secure random token, stores it with a 1-hour expiration and single-use flag, and sends an email containing a reset link to the user (via Brevo).
3. The reset link points to the frontend (configured with `FRONTEND_URL`) and includes the token. The frontend collects the new password and posts it to `POST /api/auth/reset-password` along with the email and token.
4. Server validates the token+email combination, checks expiration and whether it was already used, updates the user's password (bcrypt hashed), and marks the token as used.

### Environment variables for email delivery

Add these to your `.env` file to enable Brevo email sending and correct reset link generation:

```bash
# Brevo transactional email API key
BREVO_API_KEY=your-brevo-api-key
# From address shown in reset emails
BREVO_SENDER_EMAIL=noreply@yourdomain.com
BREVO_SENDER_NAME=Teams API
# Frontend URL used to build the reset link (e.g. https://app.example.com)
FRONTEND_URL=http://localhost:4200
```

### Endpoints

#### Request password reset

POST /api/auth/request-reset

Request body:

```json
{ "email": "user@example.com" }
```

Response (200):

```json
{ "message": "If an account exists with this email, you will receive a password reset link shortly." }
```

Notes:
- For security, the endpoint always returns a generic success message to avoid email enumeration.
- A reset token and record are created only if the user exists.

#### Reset password using token

POST /api/auth/reset-password

Request body:

```json
{
  "email": "user@example.com",
  "resetToken": "<token-from-email>",
  "newPassword": "myNewSecurePassword123"
}
```

Response (200):

```json
{ "message": "Password has been reset successfully" }
```

Errors (400/404):
- Invalid or expired token
- Token already used
- User not found (404)

### Example curl flow

1) Request a reset:

```bash
curl -X POST http://localhost:3000/api/auth/request-reset \
  -H "Content-Type: application/json" \
  -d '{ "email": "test@example.com" }'
```

2) Reset password (after opening link from email and collecting token):

```bash
curl -X POST http://localhost:3000/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{ "email": "test@example.com", "resetToken": "<token>", "newPassword": "newPassword123" }'
```

### Security considerations

- Reset tokens are generated using a cryptographically secure RNG and are sufficiently long (32 bytes hex).
- Tokens expire after 1 hour and are single-use.
- The API always returns a non-disclosing message on the request-reset endpoint to avoid revealing whether an email is registered.
- Passwords must meet the same validation rules as during registration and are stored hashed with bcrypt.

## Integration with Existing API

## Integration with Existing API

The authentication system is fully integrated with the existing Teams API:

- All existing endpoints remain unchanged
- Authentication is optional for most endpoints (can be added as needed)
- The `/api/auth/me` endpoint demonstrates protected route implementation
- Ready to protect other routes by adding `authenticateToken` middleware

## Next Steps

To protect existing routes, add the authentication middleware:

```typescript
import { authenticateToken } from '../middleware/auth';

// Protect a route
router.post('/api/groups', authenticateToken, createGroup);
```
