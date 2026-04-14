import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Decimal } from "decimal.js";
import { hashPassword } from "better-auth/crypto";
import { encrypt } from "../src/lib/encryption";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

const ADMIN_EMAIL = "admin@tally.dev";
const ADMIN_PASSWORD = "admin123";

const MSP_USER_EMAIL = "msp@acme.test";
const MSP_USER_PASSWORD = "msp123";

const CLIENT_USER_EMAIL = "admin@widget.test";
const CLIENT_USER_PASSWORD = "client123";

/**
 * Encrypt vendor credentials for seed data.
 * Falls back to a placeholder if ENCRYPTION_KEY is not configured,
 * logging a clear warning so developers know to set it.
 */
function encryptCredentials(json: object): string {
  try {
    return encrypt(JSON.stringify(json));
  } catch (err) {
    console.warn(
      "   ⚠ ENCRYPTION_KEY not configured — storing placeholder credentials.",
      "Set ENCRYPTION_KEY in .env to enable real encryption.",
      String(err),
    );
    return "seed-demo-credentials-placeholder";
  }
}

async function main() {
  // ---------------------------------------------------------------
  // 1. Super Admin User (Tally staff — SUPER_ADMIN platform role)
  // ---------------------------------------------------------------
  console.log("🌱 Seeding super admin user…");
  const adminUser = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { platformRole: "SUPER_ADMIN" },
    create: {
      name: "Tally Admin",
      email: ADMIN_EMAIL,
      emailVerified: true,
      platformRole: "SUPER_ADMIN",
    },
  });
  console.log(`   ✔ User: ${adminUser.name} (${adminUser.id}) — SUPER_ADMIN`);

  // ---------------------------------------------------------------
  // 1b. Admin Account (email + password credential)
  // ---------------------------------------------------------------
  console.log("🌱 Seeding admin account (credential)…");
  const hashedAdminPassword = await hashPassword(ADMIN_PASSWORD);
  const existingAdminAccount = await prisma.account.findFirst({
    where: { userId: adminUser.id, providerId: "credential" },
  });
  if (!existingAdminAccount) {
    await prisma.account.create({
      data: {
        accountId: adminUser.id,
        providerId: "credential",
        userId: adminUser.id,
        password: hashedAdminPassword,
      },
    });
    console.log(`   ✔ Account: credential provider created`);
  } else {
    console.log(`   ✔ Account: credential provider already exists`);
  }

  // ---------------------------------------------------------------
  // 1c. Demo MSP User
  // ---------------------------------------------------------------
  console.log("🌱 Seeding demo MSP user…");
  const mspUser = await prisma.user.upsert({
    where: { email: MSP_USER_EMAIL },
    update: {},
    create: {
      name: "Acme MSP Admin",
      email: MSP_USER_EMAIL,
      emailVerified: true,
    },
  });
  console.log(`   ✔ User: ${mspUser.name} (${mspUser.id})`);

  const hashedMspPassword = await hashPassword(MSP_USER_PASSWORD);
  const existingMspAccount = await prisma.account.findFirst({
    where: { userId: mspUser.id, providerId: "credential" },
  });
  if (!existingMspAccount) {
    await prisma.account.create({
      data: {
        accountId: mspUser.id,
        providerId: "credential",
        userId: mspUser.id,
        password: hashedMspPassword,
      },
    });
    console.log(`   ✔ Account: MSP user credential created`);
  }

  // ---------------------------------------------------------------
  // 1d. Demo Client User
  // ---------------------------------------------------------------
  console.log("🌱 Seeding demo client user…");
  const clientUser = await prisma.user.upsert({
    where: { email: CLIENT_USER_EMAIL },
    update: {},
    create: {
      name: "Widget Corp Admin",
      email: CLIENT_USER_EMAIL,
      emailVerified: true,
    },
  });
  console.log(`   ✔ User: ${clientUser.name} (${clientUser.id})`);

  const hashedClientPassword = await hashPassword(CLIENT_USER_PASSWORD);
  const existingClientAccount = await prisma.account.findFirst({
    where: { userId: clientUser.id, providerId: "credential" },
  });
  if (!existingClientAccount) {
    await prisma.account.create({
      data: {
        accountId: clientUser.id,
        providerId: "credential",
        userId: clientUser.id,
        password: hashedClientPassword,
      },
    });
    console.log(`   ✔ Account: Client user credential created`);
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
      provisioningEnabled: true,
      isContractSigned: true,
    },
  });
  console.log(`   ✔ Client Org: ${clientOrg.name} (${clientOrg.id})`);

  // ---------------------------------------------------------------
  // 4. Members — role assignments
  // ---------------------------------------------------------------
  console.log("🌱 Seeding members…");

  // Super Admin → MSP org (MSP_OWNER)
  const adminMspMember = await prisma.member.upsert({
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
  console.log(`   ✔ Member: admin → MSP (MSP_OWNER) — ${adminMspMember.id}`);

  // MSP User → MSP org (MSP_ADMIN)
  const mspMember = await prisma.member.upsert({
    where: {
      organizationId_userId: {
        organizationId: mspOrg.id,
        userId: mspUser.id,
      },
    },
    update: {},
    create: {
      organizationId: mspOrg.id,
      userId: mspUser.id,
      mspRole: "MSP_ADMIN",
      orgRole: null,
    },
  });
  console.log(`   ✔ Member: msp user → MSP (MSP_ADMIN) — ${mspMember.id}`);

  // Client User → Client org (ORG_OWNER)
  const clientMember = await prisma.member.upsert({
    where: {
      organizationId_userId: {
        organizationId: clientOrg.id,
        userId: clientUser.id,
      },
    },
    update: {},
    create: {
      organizationId: clientOrg.id,
      userId: clientUser.id,
      orgRole: "ORG_OWNER",
      mspRole: null,
    },
  });
  console.log(`   ✔ Member: client user → Widget Corp (ORG_OWNER) — ${clientMember.id}`);

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

  const intune = await prisma.product.upsert({
    where: { canonicalSku: "INTUNE" },
    update: {},
    create: {
      canonicalSku: "INTUNE",
      name: "Microsoft Intune",
      friendlyName: "Intune",
      description: "Cloud-based device management",
      category: "Security",
      unitType: "DEVICE",
      manufacturer: "Microsoft",
    },
  });
  console.log(`   ✔ Product: ${intune.name}`);

  const defenderBusiness = await prisma.product.upsert({
    where: { canonicalSku: "DEFENDER_BUSINESS" },
    update: {},
    create: {
      canonicalSku: "DEFENDER_BUSINESS",
      name: "Microsoft Defender for Business",
      friendlyName: "Defender for Business",
      description: "Enterprise-grade endpoint security",
      category: "Security",
      unitType: "DEVICE",
      manufacturer: "Microsoft",
    },
  });
  console.log(`   ✔ Product: ${defenderBusiness.name}`);

  // ---------------------------------------------------------------
  // 6. Bundles — Microsoft 365 E3 + Microsoft 365 Business Premium
  // ---------------------------------------------------------------
  console.log("🌱 Seeding bundles…");
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

  const m365BP = await prisma.bundle.upsert({
    where: { globalSkuId: "CFQ7TTC0LH18" },
    update: {},
    create: {
      globalSkuId: "CFQ7TTC0LH18",
      name: "Microsoft 365 Business Premium",
      friendlyName: "M365 Business Premium",
      description: "All-in-one productivity and security solution for SMBs",
      category: "Productivity",
    },
  });
  console.log(`   ✔ Bundle: ${m365BP.name} (${m365BP.globalSkuId})`);

  // ---------------------------------------------------------------
  // 7. BundleProduct — link products to bundles
  // ---------------------------------------------------------------
  console.log("🌱 Seeding bundle–product links…");

  // M365 E3 includes Exchange, Teams, SharePoint
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

  // M365 Business Premium includes Exchange, Teams, Intune, Defender
  for (const product of [exchangeOnline, teams, intune, defenderBusiness]) {
    await prisma.bundleProduct.upsert({
      where: {
        bundleId_productId: {
          bundleId: m365BP.id,
          productId: product.id,
        },
      },
      update: {},
      create: {
        bundleId: m365BP.id,
        productId: product.id,
      },
    });
    console.log(`   ✔ Linked ${product.name} → ${m365BP.name}`);
  }

  // ---------------------------------------------------------------
  // 8. Vendor Connections — PAX8 & INGRAM for MSP org
  // ---------------------------------------------------------------
  console.log("🌱 Seeding vendor connections…");

  const pax8Credentials = encryptCredentials({
    apiKey: "demo-pax8-api-key-12345",
    partnerId: "ACME-PAX8-001",
  });
  const pax8Connection = await prisma.vendorConnection.upsert({
    where: {
      organizationId_vendorType: {
        organizationId: mspOrg.id,
        vendorType: "PAX8",
      },
    },
    update: {},
    create: {
      organizationId: mspOrg.id,
      vendorType: "PAX8",
      status: "ACTIVE",
      credentials: pax8Credentials,
      lastSyncAt: new Date(),
    },
  });
  console.log(`   ✔ VendorConnection: PAX8 (${pax8Connection.id})`);

  const ingramCredentials = encryptCredentials({
    apiKey: "demo-ingram-api-key-67890",
    resellerId: "ACME-INGRAM-001",
  });
  const ingramConnection = await prisma.vendorConnection.upsert({
    where: {
      organizationId_vendorType: {
        organizationId: mspOrg.id,
        vendorType: "INGRAM",
      },
    },
    update: {},
    create: {
      organizationId: mspOrg.id,
      vendorType: "INGRAM",
      status: "ACTIVE",
      credentials: ingramCredentials,
      lastSyncAt: new Date(),
    },
  });
  console.log(`   ✔ VendorConnection: INGRAM (${ingramConnection.id})`);

  // ---------------------------------------------------------------
  // 9. ProductOfferings — price points linked to vendor connections
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
      vendorConnectionId: pax8Connection.id,
      effectiveUnitCost: new Decimal("32.00"),
      partnerMarginPercent: new Decimal("15.00"),
      currency: "USD",
      availability: "Available",
      minQuantity: 1,
      maxQuantity: 10000,
      lastPricingFetchedAt: new Date(),
    },
  });
  console.log(
    `   ✔ Offering: PAX8 M365 E3 — $${pax8Offering.effectiveUnitCost}/seat`,
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
      vendorConnectionId: ingramConnection.id,
      effectiveUnitCost: new Decimal("31.50"),
      partnerMarginPercent: new Decimal("12.50"),
      currency: "USD",
      availability: "Available",
      minQuantity: 1,
      maxQuantity: 5000,
      lastPricingFetchedAt: new Date(),
    },
  });
  console.log(
    `   ✔ Offering: INGRAM M365 E3 — $${ingramOffering.effectiveUnitCost}/seat`,
  );

  const pax8BpOffering = await prisma.productOffering.upsert({
    where: {
      bundleId_sourceType_externalSku: {
        bundleId: m365BP.id,
        sourceType: "PAX8",
        externalSku: "PAX8-M365-BP-001",
      },
    },
    update: {},
    create: {
      bundleId: m365BP.id,
      sourceType: "PAX8",
      externalSku: "PAX8-M365-BP-001",
      vendorConnectionId: pax8Connection.id,
      effectiveUnitCost: new Decimal("22.00"),
      partnerMarginPercent: new Decimal("18.00"),
      currency: "USD",
      availability: "Available",
      minQuantity: 1,
      maxQuantity: 300,
      lastPricingFetchedAt: new Date(),
    },
  });
  console.log(
    `   ✔ Offering: PAX8 M365 BP — $${pax8BpOffering.effectiveUnitCost}/seat`,
  );

  // ---------------------------------------------------------------
  // 10. Subscriptions — client org subscriptions
  // ---------------------------------------------------------------
  console.log("🌱 Seeding subscriptions…");

  const now = new Date();
  const commitmentEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()); // 1 year from now

  const subscription1 = await prisma.subscription.upsert({
    where: { externalId: "DEMO-SUB-PAX8-E3-001" },
    update: {},
    create: {
      organizationId: clientOrg.id,
      vendorConnectionId: pax8Connection.id,
      bundleId: m365E3.id,
      externalId: "DEMO-SUB-PAX8-E3-001",
      status: "ACTIVE",
      commitmentEndDate: commitmentEnd,
    },
  });
  console.log(`   ✔ Subscription: M365 E3 via PAX8 (${subscription1.id})`);

  const subscription2 = await prisma.subscription.upsert({
    where: { externalId: "DEMO-SUB-PAX8-BP-001" },
    update: {},
    create: {
      organizationId: clientOrg.id,
      vendorConnectionId: pax8Connection.id,
      bundleId: m365BP.id,
      externalId: "DEMO-SUB-PAX8-BP-001",
      status: "ACTIVE",
      commitmentEndDate: commitmentEnd,
    },
  });
  console.log(`   ✔ Subscription: M365 BP via PAX8 (${subscription2.id})`);

  // ---------------------------------------------------------------
  // 11. Licenses — seat allocations
  // ---------------------------------------------------------------
  console.log("🌱 Seeding licenses…");

  const license1 = await prisma.license.upsert({
    where: { id: "seed-license-e3-pax8" },
    update: {},
    create: {
      id: "seed-license-e3-pax8",
      subscriptionId: subscription1.id,
      productOfferingId: pax8Offering.id,
      quantity: 50,
      pendingQuantity: null,
    },
  });
  console.log(`   ✔ License: M365 E3 × 50 seats (${license1.id})`);

  const license2 = await prisma.license.upsert({
    where: { id: "seed-license-bp-pax8" },
    update: {},
    create: {
      id: "seed-license-bp-pax8",
      subscriptionId: subscription2.id,
      productOfferingId: pax8BpOffering.id,
      quantity: 25,
      pendingQuantity: 20, // Staged scale-down
    },
  });
  console.log(`   ✔ License: M365 BP × 25 seats (pending → 20) (${license2.id})`);

  // ---------------------------------------------------------------
  // 12. Purchase Transactions
  // ---------------------------------------------------------------
  console.log("🌱 Seeding purchase transactions…");

  const tx1 = await prisma.purchaseTransaction.upsert({
    where: { idempotencyKey: "seed-tx-e3-initial" },
    update: {},
    create: {
      organizationId: clientOrg.id,
      productOfferingId: pax8Offering.id,
      quantity: 50,
      grossAmount: new Decimal("1600.00"), // 50 × $32.00
      ourMarginEarned: new Decimal("240.00"), // 15% margin
      status: "COMPLETED",
      idempotencyKey: "seed-tx-e3-initial",
      distributorReference: "PAX8-REF-001",
    },
  });
  console.log(`   ✔ Transaction: M365 E3 × 50 = $${tx1.grossAmount} (${tx1.id})`);

  const tx2 = await prisma.purchaseTransaction.upsert({
    where: { idempotencyKey: "seed-tx-bp-initial" },
    update: {},
    create: {
      organizationId: clientOrg.id,
      productOfferingId: pax8BpOffering.id,
      quantity: 25,
      grossAmount: new Decimal("550.00"), // 25 × $22.00
      ourMarginEarned: new Decimal("99.00"), // 18% margin
      status: "COMPLETED",
      idempotencyKey: "seed-tx-bp-initial",
      distributorReference: "PAX8-REF-002",
    },
  });
  console.log(`   ✔ Transaction: M365 BP × 25 = $${tx2.grossAmount} (${tx2.id})`);

  // ---------------------------------------------------------------
  // 13. Billing Snapshots
  // ---------------------------------------------------------------
  console.log("🌱 Seeding billing snapshots…");

  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  await prisma.billingSnapshot.create({
    data: {
      organizationId: clientOrg.id,
      subscriptionId: subscription1.id,
      projectedAmount: new Decimal("1600.00"),
      periodStart,
      periodEnd,
      metadata: {
        distributors: [{ type: "PAX8", lineTotal: "1600.00", quantity: 50 }],
      },
    },
  });
  console.log(`   ✔ BillingSnapshot: M365 E3 — $1,600.00`);

  await prisma.billingSnapshot.create({
    data: {
      organizationId: clientOrg.id,
      subscriptionId: subscription2.id,
      projectedAmount: new Decimal("550.00"),
      periodStart,
      periodEnd,
      metadata: {
        distributors: [{ type: "PAX8", lineTotal: "550.00", quantity: 25 }],
        committedChanges: [{ licenseId: license2.id, pendingQuantity: 20, effectiveDate: commitmentEnd.toISOString() }],
      },
    },
  });
  console.log(`   ✔ BillingSnapshot: M365 BP — $550.00`);

  // ---------------------------------------------------------------
  // 14. DPA Acceptance
  // ---------------------------------------------------------------
  console.log("🌱 Seeding DPA acceptance…");

  const existingDpa = await prisma.dpaAcceptance.findUnique({
    where: {
      organizationId_version: {
        organizationId: mspOrg.id,
        version: "1.0",
      },
    },
  });
  if (!existingDpa) {
    await prisma.dpaAcceptance.create({
      data: {
        organizationId: mspOrg.id,
        acceptedByUserId: adminUser.id,
        version: "1.0",
      },
    });
    console.log(`   ✔ DPA: v1.0 accepted by ${adminUser.name}`);
  } else {
    console.log(`   ✔ DPA: v1.0 already accepted`);
  }

  // Also accept DPA for client org
  const existingClientDpa = await prisma.dpaAcceptance.findUnique({
    where: {
      organizationId_version: {
        organizationId: clientOrg.id,
        version: "1.0",
      },
    },
  });
  if (!existingClientDpa) {
    await prisma.dpaAcceptance.create({
      data: {
        organizationId: clientOrg.id,
        acceptedByUserId: clientUser.id,
        version: "1.0",
      },
    });
    console.log(`   ✔ DPA: v1.0 accepted for Widget Corp`);
  } else {
    console.log(`   ✔ DPA: v1.0 already accepted for Widget Corp`);
  }

  // ---------------------------------------------------------------
  // 15. Insight Snapshots — AI recommendations & waste alerts
  // ---------------------------------------------------------------
  console.log("🌱 Seeding insight snapshots…");

  await prisma.insightSnapshot.create({
    data: {
      organizationId: clientOrg.id,
      type: "RECOMMENDATION",
      insightType: "RIGHT_SIZE",
      title: "Right-size Microsoft 365 E3 licenses",
      description:
        "Usage analysis shows 12 of 50 M365 E3 licenses have not been active in the past 30 days. Consider scaling down to reduce cost.",
      severity: "MEDIUM",
      entityId: license1.id,
      entityType: "LICENSE",
      potentialSavings: new Decimal("384.00"), // 12 × $32.00
      suggestedAction: "Scale down M365 E3 from 50 to 38 seats to save $384/month.",
    },
  });
  console.log(`   ✔ Insight: RIGHT_SIZE recommendation (12 unused E3 licenses)`);

  await prisma.insightSnapshot.create({
    data: {
      organizationId: clientOrg.id,
      type: "WASTE_ALERT",
      insightType: "UNUSED_LICENSE",
      title: "5 unused Business Premium licenses detected",
      description:
        "5 of 25 Microsoft 365 Business Premium licenses have zero sign-ins for over 60 days.",
      severity: "HIGH",
      entityId: license2.id,
      entityType: "LICENSE",
      estimatedWaste: new Decimal("110.00"), // 5 × $22.00
      suggestedAction: "Remove or reassign the 5 unused licenses to save $110/month.",
    },
  });
  console.log(`   ✔ Insight: WASTE_ALERT (5 unused BP licenses)`);

  await prisma.insightSnapshot.create({
    data: {
      organizationId: clientOrg.id,
      type: "RECOMMENDATION",
      insightType: "VENDOR_SWITCH",
      title: "Save by switching M365 E3 to Ingram Micro",
      description:
        "Ingram Micro offers M365 E3 at $31.50/seat compared to the current PAX8 price of $32.00/seat. Switching 50 seats would save $25/month.",
      severity: "LOW",
      entityId: subscription1.id,
      entityType: "SUBSCRIPTION",
      potentialSavings: new Decimal("25.00"), // 50 × $0.50
      suggestedAction: "Switch M365 E3 subscription from PAX8 to Ingram Micro.",
    },
  });
  console.log(`   ✔ Insight: VENDOR_SWITCH recommendation`);

  // ---------------------------------------------------------------
  // 16. Notifications
  // ---------------------------------------------------------------
  console.log("🌱 Seeding notifications…");

  await prisma.notification.create({
    data: {
      organizationId: clientOrg.id,
      userId: clientUser.id,
      type: "SUBSCRIPTION_EXPIRING",
      title: "M365 E3 commitment ending soon",
      message: `Your Microsoft 365 E3 subscription commitment ends on ${commitmentEnd.toLocaleDateString()}. Review your options.`,
      entityId: subscription1.id,
      entityType: "SUBSCRIPTION",
    },
  });
  console.log(`   ✔ Notification: SUBSCRIPTION_EXPIRING`);

  await prisma.notification.create({
    data: {
      organizationId: clientOrg.id,
      userId: null, // org-wide
      type: "WASTE_ALERT",
      title: "Unused licenses detected",
      message: "5 Microsoft 365 Business Premium licenses have been inactive for over 60 days.",
      entityId: license2.id,
      entityType: "LICENSE",
    },
  });
  console.log(`   ✔ Notification: WASTE_ALERT (org-wide)`);

  await prisma.notification.create({
    data: {
      organizationId: mspOrg.id,
      userId: mspUser.id,
      type: "INVITATION_RECEIVED",
      title: "New team member joined",
      message: `${clientUser.name} has been added to Widget Corp as ORG_OWNER.`,
      entityId: clientMember.id,
      entityType: "INVITATION",
    },
  });
  console.log(`   ✔ Notification: INVITATION_RECEIVED (MSP)`);

  // ---------------------------------------------------------------
  // 17. Audit Logs
  // ---------------------------------------------------------------
  console.log("🌱 Seeding audit logs…");

  const auditEntries = [
    {
      organizationId: mspOrg.id,
      userId: adminUser.id,
      action: "organization.created",
      entityId: mspOrg.id,
      after: { name: "Acme MSP", organizationType: "MSP", slug: "acme-msp" },
    },
    {
      organizationId: mspOrg.id,
      userId: adminUser.id,
      action: "organization.contract_signed",
      entityId: mspOrg.id,
      before: { isContractSigned: false },
      after: { isContractSigned: true, provisioningEnabled: true },
    },
    {
      organizationId: mspOrg.id,
      userId: adminUser.id,
      action: "organization.dpa_accepted",
      entityId: mspOrg.id,
      after: { version: "1.0" },
    },
    {
      organizationId: mspOrg.id,
      userId: adminUser.id,
      action: "organization.client_created",
      entityId: clientOrg.id,
      after: { name: "Widget Corp", slug: "widget-corp", organizationType: "CLIENT" },
    },
    {
      organizationId: mspOrg.id,
      userId: adminUser.id,
      action: "vendor.connected",
      entityId: pax8Connection.id,
      after: { vendorType: "PAX8", status: "ACTIVE" },
    },
    {
      organizationId: mspOrg.id,
      userId: adminUser.id,
      action: "vendor.connected",
      entityId: ingramConnection.id,
      after: { vendorType: "INGRAM", status: "ACTIVE" },
    },
    {
      organizationId: clientOrg.id,
      userId: clientUser.id,
      action: "subscription.created",
      entityId: subscription1.id,
      after: { bundleName: "Microsoft 365 E3", vendorType: "PAX8", quantity: 50 },
    },
    {
      organizationId: clientOrg.id,
      userId: clientUser.id,
      action: "license.scale_down.staged",
      entityId: license2.id,
      before: { quantity: 25 },
      after: { quantity: 25, pendingQuantity: 20 },
    },
  ];

  for (const entry of auditEntries) {
    await prisma.auditLog.create({ data: entry });
  }
  console.log(`   ✔ AuditLog: ${auditEntries.length} entries created`);

  // ---------------------------------------------------------------
  // 18. Sessions — admin session scoped to MSP org
  // ---------------------------------------------------------------
  console.log("🌱 Seeding admin session…");

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
  console.log("\n📋 Demo Accounts:");
  console.log(`   Super Admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`   MSP Admin:   ${MSP_USER_EMAIL} / ${MSP_USER_PASSWORD}`);
  console.log(`   Client Admin: ${CLIENT_USER_EMAIL} / ${CLIENT_USER_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
