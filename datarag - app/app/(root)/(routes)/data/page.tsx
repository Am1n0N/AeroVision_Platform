const jwt = require("jsonwebtoken");

const METABASE_SITE_URL = "http://localhost:3000";
const METABASE_SECRET_KEY = "6482c2d966ff24eccd95f38e0b9d230b923eee454598a7c5cf31d5b9685ac7d7";

export default function StaticDashboardPage() {
  const payload = {
    resource: { dashboard: 2 },
    params: {},
    exp: Math.round(Date.now() / 1000) + 10 * 60 // 10 minute expiration
  };

  const token = jwt.sign(payload, METABASE_SECRET_KEY);

  const iframeUrl = `${METABASE_SITE_URL}/embed/dashboard/${token}#bordered=true&titled=true`;

  return (
    <main className="align-middle justify-center flex h-full w-full">
      <iframe
        src={iframeUrl}
        className="w-full h-full border-0"
        allowTransparency={true}
        title="Metabase Dashboard"
      />
    </main>
  );
}
