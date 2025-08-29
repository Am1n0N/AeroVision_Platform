import { PrismaClient } from "@prisma/client";

declare global {
    let prisma: PrismaClient | undefined;
}

const prismadb = globalThis.prisma || new PrismaClient();
if (process.env.NODE_ENV === "development") globalThis.prisma = prismadb;

export default prismadb;
