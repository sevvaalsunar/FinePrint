import { defineConfig } from 'cypress';
export default defineConfig({
  video: true, videoCompression: 28, screenshotOnRunFailure: false,
  e2e: { baseUrl: 'http://localhost:4173', viewportWidth: 430, viewportHeight: 900, supportFile: false, defaultCommandTimeout: 8000 },
});
