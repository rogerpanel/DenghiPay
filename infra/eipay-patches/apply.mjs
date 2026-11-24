// Fixes and rebranding applied to the eipay source at image build time, on
// top of the developers' unmodified checkout. Run from the checkout root by
// infra/docker/eipay.Dockerfile:
//
//   node /tmp/eipay-patches/apply.mjs
//
// Each change names an exact block of their code and its replacement. If the
// replacement is already there (they made the change upstream) it is skipped;
// if neither is there the build stops, because the code around it changed and
// someone has to look. Nothing is matched loosely.
import { readFileSync, writeFileSync } from "node:fs";

const changes = [
  {
    what: "first-transfer gas limit 120,000 → 500,000 (Polygon tx 0xdcc6a165…a521bffe, 24 Nov)",
    // docs/EIPAY_INTEGRATION.md §1.2: the combined EIP-7702 delegation and
    // execute transaction ran out of gas inside the batch. The execute-only
    // path already uses 500,000; only gas used is paid.
    file: "app/lib/bundler/executeSponsored.ts",
    original: "const RE_DELEGATE_GAS = BigInt(120000);",
    replacement: "const RE_DELEGATE_GAS = BigInt(500000);",
  },
  {
    what: "receipt header: Expat Groupe instead of the eipay logo",
    // Brand decided 24 Nov, pending the official logo.
    file: "app/components/PDFReceipt.tsx",
    original: `          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src="/icons/eipay/eipay-icon-amber.png" style={styles.logo} />`,
    replacement: `          <Text style={{ fontSize: 18, fontWeight: 700, color: "#121217" }}>
            Expat Groupe
          </Text>`,
  },
  {
    what: "receipt: drop the eipay.app QR code and its invitation",
    // The QR image and text sent customers to the developers' own site.
    file: "app/components/PDFReceipt.tsx",
    original: `          <View style={styles.qrSection}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src="/images/eipay-qr-code.png" style={styles.qrCode} />
            <View>
              <Text style={styles.qrText}>Make more transactions</Text>
              <Text style={styles.qrText}>
                on <Text style={styles.eipay}>eipay</Text>
              </Text>
            </View>
          </View>
`,
    replacement: "",
  },
  {
    what: "receipt footer: Expat Groupe instead of eipay.app",
    file: "app/components/PDFReceipt.tsx",
    original: `          <Text style={styles.footerText}>eipay.app</Text>`,
    replacement: `          <Text style={styles.footerText}>Expat Groupe</Text>`,
  },
];

let applied = 0;
let already = 0;
for (const c of changes) {
  const text = readFileSync(c.file, "utf8");
  const has = (s) => s !== "" && text.includes(s);
  if (has(c.original)) {
    if (text.split(c.original).length !== 2) {
      console.error(`eipay patch: ${c.file} has the original block more than once — review it — ${c.what}`);
      process.exit(1);
    }
    writeFileSync(c.file, text.replace(c.original, () => c.replacement));
    console.log(`eipay patch: applied — ${c.what}`);
    applied++;
  } else if (c.replacement !== "" && has(c.replacement)) {
    console.log(`eipay patch: already fixed — ${c.what}`);
    already++;
  } else if (c.replacement === "") {
    // A removal whose block is gone: done upstream, or the code moved. The
    // first is fine; the second is caught by the review of their changes.
    console.log(`eipay patch: block already absent — ${c.what}`);
    already++;
  } else {
    console.error(`eipay patch: ${c.file} no longer has the block this change expects — review it — ${c.what}`);
    process.exit(1);
  }
}
console.log(`eipay patches: ${applied} applied, ${already} already in place`);
