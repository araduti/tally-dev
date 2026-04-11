import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import { hashPassword } from "better-auth/crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

const ADMIN_EMAIL = "admin@tally.dev";
const ADMIN_PASSWORD = "admin123";

async function main() {
  // ---------------------------------------------------------------
  // 1. Admin User
  // ---------------------------------------------------------------
  console.log("🌱 Seeding admin user…");
  const adminUser = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      name: "Tally Admin",
      email: ADMIN_EMAIL,
      emailVerified: true,
    },
  });
  console.log(`   ✔ User: ${adminUser.name} (${adminUser.id})`);

  // ---------------------------------------------------------------
  // 1b. Admin Account (email + password credential)
  // ---------------------------------------------------------------
  console.log("🌱 Seeding admin account (credential)…");
  const hashedPassword = await hashPassword(ADMIN_PASSWORD);
  const existingAccount = await prisma.account.findFirst({
    where: { userId: adminUser.id, providerId: "credential" },
  });
  if (!existingAccount) {
    await prisma.account.create({
      data: {
        accountId: adminUser.id,
        providerId: "credential",
        userId: adminUser.id,
        password: hashedPassword,
      },
    });
    console.log(`   ✔ Account: credential provider created`);
  } else {
    console.log(`   ✔ Account: credential provider already exists`);
  }

  // ---------------------------------------------------------------
  // 2. MSP Organization
  // ---------------------------------------------------------------
  console.log("🌱 Seeding MSP organization…");
  const mspOrg = await prisma.organization.upsert({
    where: { slug: "acme-msp" },
    update: {},
    create: {
      name: "Acme MSP",
      slug: "acme-msp",
      organizationType: "MSP",
      billingType: "MANUAL_INVOICE",
      provisioningEnabled: true,
      isContractSigned: true,
    },
  });
  console.log(`   ✔ MSP Org: ${mspOrg.name} (${mspOrg.id})`);

  // ---------------------------------------------------------------
  // 3. Client Organization (child of MSP)
  // ---------------------------------------------------------------
  console.log("🌱 Seeding client organization…");
  const clientOrg = await prisma.organization.upsert({
    where: { slug: "widget-corp" },
    update: {},
    create: {
      name: "Widget Corp",
      slug: "widget-corp",
      organizationType: "CLIENT",
      billingType: "MANUAL_INVOICE",
      parentOrganizationId: mspOrg.id,
    },
  });
  console.log(`   ✔ Client Org: ${clientOrg.name} (${clientOrg.id})`);

  // ---------------------------------------------------------------
  // 4. Member — admin user → MSP org (MSP_OWNER)
  // ---------------------------------------------------------------
  console.log("🌱 Seeding MSP member…");
  const member = await prisma.member.upsert({
    where: {
      organizationId_userId: {
        organizationId: mspOrg.id,
        userId: adminUser.id,
      },
    },
    update: {},
    create: {
      organizationId: mspOrg.id,
      userId: adminUser.id,
      mspRole: "MSP_OWNER",
      orgRole: null,
    },
  });
  console.log(`   ✔ Member: ${member.id} (MSP_OWNER)`);

  // ---------------------------------------------------------------
  // 5. Products
  // ---------------------------------------------------------------
  console.log("🌱 Seeding products…");

  const exchangeOnline = await prisma.product.upsert({
    where: { canonicalSku: "EXCHANGE_ONLINE" },
    update: {},
    create: {
      canonicalSku: "EXCHANGE_ONLINE",
      name: "Exchange Online",
      friendlyName: "Exchange Online",
      description: "Cloud-based email and calendar service",
      category: "Productivity",
      unitType: "SEAT",
      manufacturer: "Microsoft",
    },
  });
  console.log(`   ✔ Product: ${exchangeOnline.name}`);

  const teams = await prisma.product.upsert({
    where: { canonicalSku: "TEAMS" },
    update: {},
    create: {
      canonicalSku: "TEAMS",
      name: "Microsoft Teams",
      friendlyName: "Teams",
      description: "Collaboration and communication platform",
      category: "Productivity",
      unitType: "SEAT",
      manufacturer: "Microsoft",
    },
  });
  console.log(`   ✔ Product: ${teams.name}`);

  const sharePointOnline = await prisma.product.upsert({
    where: { canonicalSku: "SHAREPOINT_ONLINE" },
    update: {},
    create: {
      canonicalSku: "SHAREPOINT_ONLINE",
      name: "SharePoint Online",
      friendlyName: "SharePoint Online",
      description: "Web-based document management and collaboration",
      category: "Productivity",
      unitType: "SEAT",
      manufacturer: "Microsoft",
    },
  });
  console.log(`   ✔ Product: ${sharePointOnline.name}`);

  // ---------------------------------------------------------------
  // 6. Bundle — Microsoft 365 E3
  // ---------------------------------------------------------------
  console.log("🌱 Seeding bundle…");
  const m365E3 = await prisma.bundle.upsert({
    where: { globalSkuId: "CFQ7TTC0LFLX" },
    update: {},
    create: {
      globalSkuId: "CFQ7TTC0LFLX",
      name: "Microsoft 365 E3",
      friendlyName: "M365 E3",
      description: "Enterprise productivity suite with advanced compliance",
      category: "Productivity",
    },
  });
  console.log(`   ✔ Bundle: ${m365E3.name} (${m365E3.globalSkuId})`);

  // ---------------------------------------------------------------
  // 7. BundleProduct — link products to bundle
  // ---------------------------------------------------------------
  console.log("🌱 Seeding bundle–product links…");

  for (const product of [exchangeOnline, teams, sharePointOnline]) {
    await prisma.bundleProduct.upsert({
      where: {
        bundleId_productId: {
          bundleId: m365E3.id,
          productId: product.id,
        },
      },
      update: {},
      create: {
        bundleId: m365E3.id,
        productId: product.id,
      },
    });
    console.log(`   ✔ Linked ${product.name} → ${m365E3.name}`);
  }

  // ---------------------------------------------------------------
  // 8. ProductOfferings — PAX8 & INGRAM price points
  // ---------------------------------------------------------------
  console.log("🌱 Seeding product offerings…");

  const pax8Offering = await prisma.productOffering.upsert({
    where: {
      bundleId_sourceType_externalSku: {
        bundleId: m365E3.id,
        sourceType: "PAX8",
        externalSku: "PAX8-M365-E3-001",
      },
    },
    update: {},
    create: {
      bundleId: m365E3.id,
      sourceType: "PAX8",
      externalSku: "PAX8-M365-E3-001",
      effectiveUnitCost: new Decimal("32.00"),
      partnerMarginPercent: new Decimal("15.00"),
      currency: "USD",
      availability: "Available",
      minQuantity: 1,
      maxQuantity: 10000,
    },
  });
  console.log(
    `   ✔ Offering: PAX8 — $${pax8Offering.effectiveUnitCost}/seat (${pax8Offering.id})`,
  );

  const ingramOffering = await prisma.productOffering.upsert({
    where: {
      bundleId_sourceType_externalSku: {
        bundleId: m365E3.id,
        sourceType: "INGRAM",
        externalSku: "INGRAM-M365-E3-001",
      },
    },
    update: {},
    create: {
      bundleId: m365E3.id,
      sourceType: "INGRAM",
      externalSku: "INGRAM-M365-E3-001",
      effectiveUnitCost: new Decimal("31.50"),
      partnerMarginPercent: new Decimal("12.50"),
      currency: "USD",
      availability: "Available",
      minQuantity: 1,
      maxQuantity: 5000,
    },
  });
  console.log(
    `   ✔ Offering: INGRAM — $${ingramOffering.effectiveUnitCost}/seat (${ingramOffering.id})`,
  );

  // ---------------------------------------------------------------
  // 9. Session — admin session scoped to MSP org
  // ---------------------------------------------------------------
  console.log("🌱 Seeding admin session…");

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const sessionToken = "seed-session-token-admin";

  const session = await prisma.session.upsert({
    where: { token: sessionToken },
    update: {
      expiresAt,
      updatedAt: now,
    },
    create: {
      id: "seed-session-admin",
      token: sessionToken,
      userId: adminUser.id,
      activeOrganizationId: mspOrg.id,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
  });
  console.log(`   ✔ Session: ${session.id} (expires ${session.expiresAt.toISOString()})`);

  // ---------------------------------------------------------------
  console.log("\n✅ Seed completed successfully!");
}

main()
  .catch((error: unknown) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
