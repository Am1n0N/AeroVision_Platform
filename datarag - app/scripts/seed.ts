const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();

async function main() {
    try {
        await db.category.createMany({
            data: [
                {
                    name: "Contract",
                },
                {
                    name: "Misc",
                },
                {
                    name: "Financial Statements",
                },
                {
                    name: "Policies and Procedures",
                },
                {
                    name: "Employee Handbook",
                },
                {
                    name: "Legal Agreements",
                },
                {
                    name: "Marketing Materials",
                },
                {
                    name: "Business Plans",
                },
                {
                    name: "Internal Memos",
                },
                {
                    name: "Training Materials",
                },
                {
                    name: "Product Specifications",
                },
                {
                    name: "Customer Agreements",
                },
                {
                    name: "Sales Reports",
                },
                {
                    name: "Research Reports",
                },
                {
                    name: "Company Bylaws",
                },
                {
                    name: "Meeting Minutes",
                },
                {
                    name: "Invoices",
                },
                {
                    name: "Expense Reports",
                },
                {
                    name: "Human Resources Forms",
                },
                {
                    name: "Quality Assurance Documents",
                }
            ],
        });        
    }
    catch(e){
                console.error("Error seeding database: ", e);
    } finally {
        await db.$disconnect();
    }
}

main();