import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Existing workspace tests exercise returning visits. Onboarding tests explicitly
// clear/reset the preference to cover fresh visits and storage failures.
localStorage.setItem('atlas.audience.v1', JSON.stringify({audience:'general_public',onboardingComplete:true}));
afterEach(cleanup);
