// Security test for SECURITY.md: Account B must not be able to read, change or delete Account A's
// saved places and trips, and visitors who aren't signed in must get nothing.
// Uses two throwaway test accounts from tests/.env.test (git ignores it); creates them the first time.
// No AI calls: this test costs $0. It deletes Account A's test rows at the end.
//
// Run: node --env-file=tests/.env.test tests/account-isolation-test.js

const SUPABASE_URL = "https://lvppxkjxtwsvxwsyalpy.supabase.co";
const KEY = "sb_publishable_TuCUmANdCyLkqOEZzh-vKA_fBhiGxDP"; // public key, same as in the app
const { TEST_A_EMAIL, TEST_A_PASSWORD, TEST_B_EMAIL, TEST_B_PASSWORD } = process.env;
if (!TEST_A_EMAIL || !TEST_B_EMAIL) {
  console.error("Missing test accounts. Run: node --env-file=tests/.env.test tests/account-isolation-test.js");
  process.exit(1);
}

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

// Signs in, or creates the account the first time. Returns { token, id }.
async function signIn(email, password) {
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  const body = JSON.stringify({ email, password });
  let res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers, body });
  if (!res.ok) res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers, body });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Couldn't sign in ${email}: ${data.msg || data.error_description || JSON.stringify(data)}`);
  return { token: data.access_token, id: data.user.id };
}

// One database request as a given person (or as a visitor who isn't signed in, when who is null).
async function api(who, method, path, body) {
  const headers = { apikey: KEY, "Content-Type": "application/json", Prefer: "return=representation" };
  if (who) headers.Authorization = `Bearer ${who.token}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

(async () => {
  console.log(`Account isolation test · ${new Date().toString()}\n`);
  const A = await signIn(TEST_A_EMAIL, TEST_A_PASSWORD);
  const B = await signIn(TEST_B_EMAIL, TEST_B_PASSWORD);
  console.log(`Signed in as Account A (${TEST_A_EMAIL}) and Account B (${TEST_B_EMAIL})\n`);

  // Account A saves a place list and a trip.
  const list = await api(A, "POST", "place_lists", {
    home_city: "Test City A",
    places: [{ kind: "love", name: "A's secret favorite", note: "only A should see this" }],
  });
  const trip = await api(A, "POST", "trips", { destination: "A's secret trip", purpose: "test", guide: { eat: [] } });
  check("A can save a place list", list.status === 201, `status ${list.status}`);
  check("A can save a trip", trip.status === 201, `status ${trip.status}`);
  const listId = list.data?.[0]?.id;
  const tripId = trip.data?.[0]?.id;

  // Account B tries to read A's data.
  const bLists = await api(B, "GET", "place_lists?select=*");
  const bTrips = await api(B, "GET", "trips?select=*");
  check("B reads all place lists: sees none of A's", Array.isArray(bLists.data) && !bLists.data.some((r) => r.user_id === A.id), `got ${bLists.data.length} rows`);
  check("B reads all trips: sees none of A's", Array.isArray(bTrips.data) && !bTrips.data.some((r) => r.user_id === A.id), `got ${bTrips.data.length} rows`);
  const bById = await api(B, "GET", `trips?id=eq.${tripId}&select=*`);
  check("B asks for A's trip by its id: empty", Array.isArray(bById.data) && bById.data.length === 0, `got ${bById.data.length} rows`);

  // Account B tries to change and delete A's data.
  const bEdit = await api(B, "PATCH", `place_lists?id=eq.${listId}`, { home_city: "Hacked by B" });
  check("B edits A's place list: nothing changed", Array.isArray(bEdit.data) && bEdit.data.length === 0, `${bEdit.data.length} rows changed`);
  const bDelete = await api(B, "DELETE", `trips?id=eq.${tripId}`);
  check("B deletes A's trip: nothing deleted", Array.isArray(bDelete.data) && bDelete.data.length === 0, `${bDelete.data.length} rows deleted`);
  const bForge = await api(B, "POST", "trips", { user_id: A.id, destination: "planted by B", guide: {} });
  check("B saves a trip under A's account: refused", bForge.status === 403, `status ${bForge.status}`);

  // A's data is still there and unchanged.
  const aLists = await api(A, "GET", `place_lists?id=eq.${listId}&select=home_city`);
  const aTrips = await api(A, "GET", `trips?id=eq.${tripId}&select=id`);
  check("A's place list is unchanged", aLists.data?.[0]?.home_city === "Test City A", `home city: ${aLists.data?.[0]?.home_city}`);
  check("A's trip still exists", aTrips.data?.length === 1);

  // A visitor who isn't signed in gets nothing.
  const anonRead = await api(null, "GET", "trips?select=*");
  const anonAdd = await api(null, "POST", "place_lists", { home_city: "x", places: [] });
  check("Not signed in: reading trips refused", anonRead.status === 401, `status ${anonRead.status}`);
  check("Not signed in: saving refused", anonAdd.status === 401, `status ${anonAdd.status}`);

  // Clean up A's test rows.
  await api(A, "DELETE", `place_lists?id=eq.${listId}`);
  await api(A, "DELETE", `trips?id=eq.${tripId}`);
  console.log(`\nCleaned up the test rows.\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
