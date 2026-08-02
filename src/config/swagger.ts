import swaggerJSDoc from 'swagger-jsdoc';
import { env } from './env';

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'NexusCapital API',
      version: '1.0.0',
      description:
        'Backend API for the NexusCapital investment dashboard — auth, packages, deposits, withdrawals, referrals, notifications, analytics, security, and currency.',
    },
    servers: [{ url: env.API_BASE_URL, description: 'Current environment' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    tags: [
      { name: 'Auth' },
      { name: 'Users' },
      { name: 'Packages' },
      { name: 'Deposits' },
      { name: 'Withdrawals' },
      { name: 'Referrals' },
      { name: 'Notifications' },
      { name: 'Analytics' },
      { name: 'Security' },
      { name: 'Currency' },
      { name: 'Payments' },
      { name: 'Admin' },
    ],
  },
  apis: ['./src/modules/**/*.ts'],
});
