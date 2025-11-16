# Frontend Authentication Integration Guide

## Quick Start

### 1. User Registration

**Endpoint:** `POST /auth/register`

```javascript
const register = async (email, password, firstName, lastName) => {
  const response = await fetch('http://localhost:3000/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, firstName, lastName })
  });
  const { user, token } = await response.json();
  localStorage.setItem('token', token);
  return user;
};
```

### 2. User Login

**Endpoint:** `POST /auth/login`

```javascript
const login = async (email, password) => {
  const response = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const { user, token } = await response.json();
  localStorage.setItem('token', token);
  return user;
};
```

### 3. User Logout

```javascript
const logout = () => {
  localStorage.removeItem('token');
  // Redirect to login
};
```

### 4. Get Current User

**Endpoint:** `GET /auth/me` (Protected)

```javascript
const getCurrentUser = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch('http://localhost:3000/auth/me', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return await response.json();
};
```

### 5. Password Reset Flow

#### Step 1: Request Reset Link

**Endpoint:** `POST /auth/request-reset`

```javascript
const requestPasswordReset = async (email) => {
  const response = await fetch('http://localhost:3000/auth/request-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  });
  return await response.json();
};
```

#### Step 2: Reset Password Form Page

Create a page at `/reset-password?token=<token>&email=<email>`:

```javascript
const resetPassword = async (email, resetToken, newPassword) => {
  const response = await fetch('http://localhost:3000/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, resetToken, newPassword })
  });
  return await response.json();
};
```

## HTTP Helper with Auth

Create a reusable fetch wrapper:

```javascript
export const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`http://localhost:3000${endpoint}`, {
    ...options,
    headers
  });
  
  if (response.status === 401) {
    // Token expired or invalid
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  
  return response.json();
};
```

## Error Handling

```javascript
try {
  const user = await login(email, password);
} catch (error) {
  if (error.status === 401) {
    // Invalid credentials
  } else if (error.status === 409) {
    // Email already registered
  } else if (error.status === 400) {
    // Validation error
  }
}
```

## Token Management

- **Storage:** Use `localStorage.setItem('token', token)` or secure HTTP-only cookies
- **Expiration:** Default 24 hours (configurable via `JWT_EXPIRATION` env var)
- **Refresh:** Implement token refresh if needed (add `POST /auth/refresh` endpoint)

## CORS Configuration

Frontend should be accessible from `http://localhost:3000` (or configured URL). CORS is enabled by default.

## Example React Hook

```javascript
const useAuth = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const { user, token } = await apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      localStorage.setItem('token', token);
      setUser(user);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
  };

  return { user, login, logout, loading };
};
```

## Key Points

- **JWT Tokens:** All protected endpoints require the `Authorization: Bearer <token>` header
- **Email Validation:** Frontend should validate email format before sending
- **Password Requirements:** Send password as-is; backend handles hashing with bcrypt
- **HTTPS in Production:** Always use HTTPS in production for token transmission
- **Secure Storage:** Consider using secure HTTP-only cookies instead of localStorage for sensitive environments
- **Error Messages:** Display user-friendly error messages, don't expose internal API details

This guide provides everything your frontend needs to integrate registration, login, logout, and password reset flows with concise, production-ready examples.
