import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { User } from '../src/models/User.js';

const trustedOrigin = 'http://localhost:5173';
const createAgent = () => request.agent(app);

async function bootstrapCsrf(agent, origin = trustedOrigin) {
  const response = await agent.get('/api/v1/auth/csrf').set('Origin', origin);
  return response.body.csrfToken;
}

async function registerWithCsrf(agent, payload) {
  const csrfToken = await bootstrapCsrf(agent);
  return agent.post('/api/v1/auth/register')
    .set('Origin', trustedOrigin)
    .set('X-CSRF-Token', csrfToken)
    .send(payload);
}

beforeAll(async () => {
  await connectDatabase();
  await User.init();
});

beforeEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
  await mongoose.connection.close();
});

describe('authentication and user preferences', () => {
  it('keeps the public health endpoint available', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', service: 'civicsignal-api' });
  });

  it('bootstraps without Origin and sets only the CSRF cookie', async () => {
    const agent = createAgent();
    const response = await agent.get('/api/v1/auth/csrf');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.csrfToken).toBeTruthy();
    const csrfCookie = response.headers['set-cookie'].find((cookie) => cookie.startsWith('civicsignal_csrf='));
    expect(csrfCookie).toContain('Path=/api');
    expect(csrfCookie).toContain('SameSite=Lax');
    expect(csrfCookie).not.toContain('HttpOnly');
    expect(response.headers['set-cookie'].some((cookie) => cookie.startsWith('civicsignal_access='))).toBe(false);
  });

  it('bootstraps with a trusted Origin', async () => {
    const response = await createAgent().get('/api/v1/auth/csrf').set('Origin', trustedOrigin);
    expect(response.status).toBe(200);
    expect(response.body.csrfToken).toBeTruthy();
    expect(response.headers['set-cookie'].some((cookie) => cookie.startsWith('civicsignal_csrf='))).toBe(true);
  });

  it('rejects a CSRF bootstrap request from an untrusted Origin', async () => {
    const response = await createAgent().get('/api/v1/auth/csrf').set('Origin', 'https://attacker.invalid');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORIGIN_REJECTED');
  });

  it('registers a user, stores a bcrypt hash, and issues protected cookies', async () => {
    const agent = createAgent();
    const response = await registerWithCsrf(agent, {
      email: 'Citizen@Example.com', password: 'A secure pass 123!', languagePreference: 'te-IN',
    });

    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({ email: 'citizen@example.com', languagePreference: 'te-IN' });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(response.body).not.toHaveProperty('token');
    expect(response.body.csrfToken).toBeTruthy();
    const authCookie = response.headers['set-cookie'].find((cookie) => cookie.startsWith('civicsignal_access='));
    expect(authCookie).toContain('HttpOnly');
    expect(authCookie).toContain('SameSite=Lax');
    const saved = await User.findOne({ email: 'citizen@example.com' }).select('+passwordHash');
    expect(saved.passwordHash).not.toBe('A secure pass 123!');
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/);

    const profile = await agent.get('/api/v1/users/me');
    expect(profile.status).toBe(200);
    expect(profile.body.user.languagePreference).toBe('te-IN');
    expect(profile.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate accounts and invalid language preferences', async () => {
    const agent = createAgent();
    const payload = { email: 'citizen@example.com', password: 'A secure pass 123!' };
    const first = await registerWithCsrf(agent, payload);
    expect(first.status).toBe(201);

    const duplicate = await registerWithCsrf(createAgent(), payload);
    expect(duplicate.status).toBe(409);

    const invalidLanguage = await registerWithCsrf(createAgent(), {
      ...payload, email: 'other@example.com', languagePreference: 'ta-IN',
    });
    expect(invalidLanguage.status).toBe(400);
    expect(await User.countDocuments()).toBe(1);
  });

  it('logs in with the right password and gives a generic failure for a wrong password', async () => {
    const agent = createAgent();
    await registerWithCsrf(agent, { email: 'citizen@example.com', password: 'A secure pass 123!' });

    const loginCsrf = await bootstrapCsrf(agent);
    const login = await agent.post('/api/v1/auth/login').set('Origin', trustedOrigin).set('X-CSRF-Token', loginCsrf)
      .send({ email: 'CITIZEN@example.com', password: 'A secure pass 123!' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('citizen@example.com');

    const wrongAgent = createAgent();
    const wrongCsrf = await bootstrapCsrf(wrongAgent);
    const wrong = await wrongAgent.post('/api/v1/auth/login').set('Origin', trustedOrigin).set('X-CSRF-Token', wrongCsrf)
      .send({ email: 'citizen@example.com', password: 'Wrong password 123!' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.message).toBe('Invalid email or password.');
  });

  it('requires authentication and CSRF validation before updating preferences', async () => {
    const anonymous = await request(app).get('/api/v1/users/me');
    expect(anonymous.status).toBe(401);

    const agent = createAgent();
    const registered = await registerWithCsrf(agent, { email: 'citizen@example.com', password: 'A secure pass 123!' });
    const csrfToken = registered.body.csrfToken;

    const noCsrf = await agent.patch('/api/v1/users/preferences').set('Origin', trustedOrigin)
      .send({ languagePreference: 'te-IN' });
    expect(noCsrf.status).toBe(403);

    const wrongOrigin = await agent.patch('/api/v1/users/preferences').set('Origin', 'https://attacker.invalid')
      .set('X-CSRF-Token', csrfToken).send({ languagePreference: 'te-IN' });
    expect(wrongOrigin.status).toBe(403);

    const updated = await agent.patch('/api/v1/users/preferences').set('Origin', trustedOrigin)
      .set('X-CSRF-Token', csrfToken).send({ languagePreference: 'te-IN' });
    expect(updated.status).toBe(200);
    expect(updated.body.user.languagePreference).toBe('te-IN');
    expect(updated.body.user).not.toHaveProperty('passwordHash');

    const persisted = await agent.get('/api/v1/users/me');
    expect(persisted.status).toBe(200);
    expect(persisted.body.user.languagePreference).toBe('te-IN');

    const invalid = await agent.patch('/api/v1/users/preferences').set('Origin', trustedOrigin)
      .set('X-CSRF-Token', csrfToken).send({ languagePreference: 'ta-IN' });
    expect(invalid.status).toBe(400);
  });

  it('rejects registration requests from untrusted origins', async () => {
    const response = await request(app).post('/api/v1/auth/register').set('Origin', 'https://attacker.invalid')
      .send({ email: 'citizen@example.com', password: 'A secure pass 123!' });
    expect(response.status).toBe(403);
  });

  it('rejects registration and login mutations with missing CSRF tokens', async () => {
    const payload = { email: 'citizen@example.com', password: 'A secure pass 123!' };
    const register = await request(app).post('/api/v1/auth/register').set('Origin', trustedOrigin).send(payload);
    expect(register.status).toBe(403);

    const loginAgent = createAgent();
    await bootstrapCsrf(loginAgent);
    const login = await loginAgent.post('/api/v1/auth/login').set('Origin', trustedOrigin).send(payload);
    expect(login.status).toBe(403);
  });

  it('rejects registration and login mutations with invalid CSRF tokens', async () => {
    const payload = { email: 'citizen@example.com', password: 'A secure pass 123!' };
    const registerAgent = createAgent();
    await bootstrapCsrf(registerAgent);
    const register = await registerAgent.post('/api/v1/auth/register')
      .set('Origin', trustedOrigin).set('X-CSRF-Token', 'not-the-cookie-token').send(payload);
    expect(register.status).toBe(403);

    const loginAgent = createAgent();
    await bootstrapCsrf(loginAgent);
    const login = await loginAgent.post('/api/v1/auth/login')
      .set('Origin', trustedOrigin).set('X-CSRF-Token', 'not-the-cookie-token').send(payload);
    expect(login.status).toBe(403);
  });

  it('signs out only after CSRF validation and clears the authentication cookie', async () => {
    const agent = createAgent();
    const registered = await registerWithCsrf(agent, { email: 'citizen@example.com', password: 'A secure pass 123!' });
    const rejected = await agent.post('/api/v1/auth/logout').set('Origin', trustedOrigin).send({});
    expect(rejected.status).toBe(403);
    expect((await agent.get('/api/v1/users/me')).status).toBe(200);

    const loggedOut = await agent.post('/api/v1/auth/logout').set('Origin', trustedOrigin)
      .set('X-CSRF-Token', registered.body.csrfToken).send({});
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.headers['set-cookie'].some((cookie) => cookie.startsWith('civicsignal_access=') && cookie.includes('Expires='))).toBe(true);
    expect((await agent.get('/api/v1/users/me')).status).toBe(401);
  });
});
