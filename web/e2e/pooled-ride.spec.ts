import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

// The whole story in real browsers: two passengers pool into Jashim's Bullet, and each sees only
// their own pooled fare. Run it against a seeded database; it also regenerates docs/screenshots.
const BASE_URL = process.env.WEB_URL ?? "http://localhost:3000";
const SHOTS = path.join(__dirname, "../../docs/screenshots");
const DESKTOP = { width: 1000, height: 900 };
const MOBILE = { width: 390, height: 844 };
const POLL_TIMEOUT = 10_000; // the pages poll every 3 seconds

const shot = (page: Page, file: string) =>
  page.screenshot({ path: path.join(SHOTS, file), caret: "initial", animations: "disabled" });

async function signInAs(browser: Browser, name: "Nusrat" | "Rafiq" | "Jashim") {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: DESKTOP });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.waitForURL(name === "Jashim" ? "**/driver" : "**/passenger");
  return { context, page };
}

async function requestRide(page: Page, pickup: string, destination: string) {
  await page.getByLabel("Pickup area").selectOption({ label: pickup });
  await page.getByLabel("Destination area").selectOption({ label: destination });
  await page.getByRole("button", { name: "Request ride" }).click();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
}

test("Nusrat and Rafiq pool into Jashim's Bullet and pay ৳68.00 and ৳56.00", async ({ browser }) => {
  // Login page, desktop and phone.
  const stranger = await browser.newContext({ baseURL: BASE_URL, viewport: DESKTOP });
  const loginPage = await stranger.newPage();
  await loginPage.goto("/login");
  await expect(loginPage.getByRole("button", { name: /Nusrat/ })).toBeVisible();
  await shot(loginPage, "01-login.png");
  await loginPage.setViewportSize(MOBILE);
  await expectNoHorizontalScroll(loginPage);
  await shot(loginPage, "mobile-login.png");
  await stranger.close();

  // Nusrat asks for a ride; nobody has a ride open yet, so she waits as REQUESTED.
  const nusrat = await signInAs(browser, "Nusrat");
  await requestRide(nusrat.page, "Banani", "Mohakhali");
  await expect(nusrat.page.locator('[data-status="REQUESTED"]').first()).toBeVisible();
  await expect(nusrat.page.getByText("৳85.00")).toBeVisible();
  await shot(nusrat.page, "02-passenger-request.png");

  // Jashim goes online (repeatable: he starts offline), sees her request and accepts it.
  const jashim = await signInAs(browser, "Jashim");
  await jashim.page.request.post("/api/driver/offline");
  await jashim.page.reload();
  await jashim.page.getByRole("button", { name: "Go online" }).click();
  await expect(jashim.page.getByText("Nusrat · 1 seat")).toBeVisible({ timeout: POLL_TIMEOUT });
  await shot(jashim.page, "04-driver-requests.png");
  await jashim.page.getByRole("button", { name: "Accept" }).click();
  await expect(jashim.page.getByText("1 of 3 seats taken")).toBeVisible();

  // Nusrat's page notices by polling.
  await expect(nusrat.page.locator('[data-status="MATCHED"]').first()).toBeVisible({
    timeout: POLL_TIMEOUT,
  });
  await expect(nusrat.page.getByText("Jashim", { exact: true })).toBeVisible();

  // Rafiq asks for the same pickup: he joins Jashim's open ride at once, no acceptance needed.
  const rafiq = await signInAs(browser, "Rafiq");
  await requestRide(rafiq.page, "Banani", "Gulshan 1");
  await expect(rafiq.page.locator('[data-status="MATCHED"]').first()).toBeVisible();
  await expect(rafiq.page.getByText("Jashim", { exact: true })).toBeVisible();
  await shot(rafiq.page, "03-passenger-matched.png");

  // The driver sees the pooled ride with both passengers.
  await expect(jashim.page.getByText("2 of 3 seats taken")).toBeVisible({ timeout: POLL_TIMEOUT });
  await expect(jashim.page.getByText("Nusrat", { exact: true })).toBeVisible();
  await expect(jashim.page.getByText("Rafiq", { exact: true })).toBeVisible();
  await shot(jashim.page, "05-driver-active-ride.png");
  const phoneDriver = await browser.newContext({
    baseURL: BASE_URL,
    viewport: MOBILE,
    deviceScaleFactor: 2,
    storageState: await jashim.context.storageState(),
  });
  const phoneDriverPage = await phoneDriver.newPage();
  await phoneDriverPage.goto("/driver");
  await expect(phoneDriverPage.getByText("2 of 3 seats taken")).toBeVisible();
  await expectNoHorizontalScroll(phoneDriverPage);
  await shot(phoneDriverPage, "mobile-driver-active-ride.png");
  await phoneDriver.close();

  // Arrive, start, complete.
  await jashim.page.getByRole("button", { name: "Arrive" }).click();
  await expect(jashim.page.locator('[data-status="DRIVER_ARRIVED"]').first()).toBeVisible();
  await jashim.page.getByRole("button", { name: "Start" }).click();
  await expect(jashim.page.locator('[data-status="STARTED"]').first()).toBeVisible();
  await jashim.page.getByRole("button", { name: "Complete" }).click();
  await expect(jashim.page.getByText(/No open requests right now/)).toBeVisible();
  await expect(jashim.page.getByText("2 passengers · 2 seats")).toBeVisible();

  // Each passenger sees their own pooled fare, and never the other's.
  await expect(nusrat.page.locator('[data-status="COMPLETED"]').first()).toBeVisible({
    timeout: POLL_TIMEOUT,
  });
  await expect(rafiq.page.locator('[data-status="COMPLETED"]').first()).toBeVisible({
    timeout: POLL_TIMEOUT,
  });
  await expect(nusrat.page.getByText("৳68.00")).toBeVisible();
  await expect(rafiq.page.getByText("৳56.00")).toBeVisible();
  await expect(nusrat.page.getByText("৳56.00")).toHaveCount(0);
  await expect(rafiq.page.getByText("৳68.00")).toHaveCount(0);
  await shot(nusrat.page, "06-passenger-completed.png");

  const phonePassenger = await browser.newContext({
    baseURL: BASE_URL,
    viewport: MOBILE,
    deviceScaleFactor: 2,
    storageState: await nusrat.context.storageState(),
  });
  const phonePassengerPage = await phonePassenger.newPage();
  await phonePassengerPage.goto("/passenger");
  await expect(phonePassengerPage.getByText("৳68.00")).toBeVisible();
  await expectNoHorizontalScroll(phonePassengerPage);
  await shot(phonePassengerPage, "mobile-passenger-completed.png");
  await phonePassenger.close();

  await Promise.all([nusrat.context.close(), rafiq.context.close(), jashim.context.close()]);
});
