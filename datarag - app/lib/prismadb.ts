import { PrismaClient } from "@prisma/client";

declare global {
    // eslint-disable-next-line no-var
    var prisma: PrismaClient | undefined;
}

const prismadb = (globalThis as any).prisma || new PrismaClient();
if (process.env.NODE_ENV === "development") (globalThis as any).prisma = prismadb;

export default prismadb;
