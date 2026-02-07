import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/**/*.test.ts'],
        testTimeout: 15_000,
        hookTimeout: 15_000,
        globals: true,
    },
    define: {
        'process.env.TEST': '"1"',
    },
});
