import { PrismaClient } from "../generated/client.js";

declare global {
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma ?? new PrismaClient({
  log: ['warn', 'error'], // or 'query' for debugging
});

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

export default prisma;