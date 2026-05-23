import { PrismaClient } from '../dist/generated/prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clear existing data
  await prisma.attendance.deleteMany();
  await prisma.employee.deleteMany();

  // Seed Supervisors
  const supervisors = await Promise.all([
    prisma.employee.create({
      data: {
        EMP_ID: 'SUP001',
        EMPNAME: 'Rajesh Kumar',
        EMPFNAME: 'Kumar',
        EMPDESG: 'Plant Manager',
        EMPTYPE: 'SUPERVISOR',
        STATUS: 'A', // pre-approved supervisor
      },
    }),
    prisma.employee.create({
      data: {
        EMP_ID: 'SUP002',
        EMPNAME: 'Priya Sharma',
        EMPFNAME: 'Sharma',
        EMPDESG: 'Shift Supervisor',
        EMPTYPE: 'SUPERVISOR',
        STATUS: 'A',
      },
    }),
  ]);

  // Seed Individual Employees
  const individuals = await Promise.all([
    prisma.employee.create({
      data: {
        EMP_ID: 'EMP001',
        EMPNAME: 'Amit Verma',
        EMPFNAME: 'Verma',
        EMPDESG: 'Machine Operator',
        EMPTYPE: 'INDIVIDUAL',
        STATUS: 'A',
      },
    }),
    prisma.employee.create({
      data: {
        EMP_ID: 'EMP002',
        EMPNAME: 'Sunita Patel',
        EMPFNAME: 'Patel',
        EMPDESG: 'Quality Inspector',
        EMPTYPE: 'INDIVIDUAL',
        STATUS: 'A',
      },
    }),
    prisma.employee.create({
      data: {
        EMP_ID: 'EMP003',
        EMPNAME: 'Ravi Singh',
        EMPFNAME: 'Singh',
        EMPDESG: 'Technician',
        EMPTYPE: 'INDIVIDUAL',
        STATUS: 'A',
      },
    }),
    prisma.employee.create({
      data: {
        EMP_ID: 'EMP004',
        EMPNAME: 'Meena Gupta',
        EMPFNAME: 'Gupta',
        EMPDESG: 'Packaging Staff',
        EMPTYPE: 'INDIVIDUAL',
        STATUS: 'A',
      },
    }),
    prisma.employee.create({
      data: {
        EMP_ID: 'EMP005',
        EMPNAME: 'Deepak Yadav',
        EMPFNAME: 'Yadav',
        EMPDESG: 'Forklift Operator',
        EMPTYPE: 'INDIVIDUAL',
        STATUS: 'A',
      },
    }),
    prisma.employee.create({
      data: {
        EMP_ID: 'EMP006',
        EMPNAME: 'Kavita Joshi',
        EMPFNAME: 'Joshi',
        EMPDESG: 'Machine Operator',
        EMPTYPE: 'INDIVIDUAL',
        STATUS: 'NA', // pending approval
      },
    }),
  ]);

  console.log(`✅ Seeded ${supervisors.length} supervisors`);
  console.log(`✅ Seeded ${individuals.length} individual employees`);
  console.log('Done!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });