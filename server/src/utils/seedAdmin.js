const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const seedAdmin = async () => {
  try {
    // 1. Seed Roles
    const rolesToSeed = ['admin', 'conductor', 'passenger'];
    for (const roleName of rolesToSeed) {
      await prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: { name: roleName },
      });
    }

    // 2. Seed Admin
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    const existingAdmin = await prisma.user.findUnique({ where: { email } });
    if (existingAdmin) return;

    const adminRole = await prisma.role.findUnique({ where: { name: 'admin' } });
    if (!adminRole) return;

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.create({
      data: {
        name: process.env.ADMIN_NAME || 'BusGo Admin',
        email,
        password: hashedPassword,
        roleId: adminRole.id,
      },
    });

    console.log('Seeded default roles and admin user');
  } catch (error) {
    console.error('Error in seedAdmin:', error);
  }
};

module.exports = seedAdmin;
