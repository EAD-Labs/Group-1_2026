const request = require('supertest');
const app = require('../src/app');
const { pool } = require('../src/config/database');

// The Android app's link to this site: off until the host sets it up.
describe('GET /.well-known/assetlinks.json', () => {
  afterEach(() => {
    delete process.env.ANDROID_PACKAGE;
    delete process.env.ANDROID_CERT_SHA256;
  });
  afterAll(() => pool.end());

  it('is a 404 until the package and key are set', async () => {
    const res = await request(app).get('/.well-known/assetlinks.json');
    expect(res.status).toBe(404);
  });

  it('names the package and every key fingerprint', async () => {
    process.env.ANDROID_PACKAGE = 'org.edupyramids.app';
    process.env.ANDROID_CERT_SHA256 = 'AA:BB, CC:DD';
    const res = await request(app).get('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'org.edupyramids.app', sha256_cert_fingerprints: ['AA:BB', 'CC:DD'] },
    }]);
  });
});
