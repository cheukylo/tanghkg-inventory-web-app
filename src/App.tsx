import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "./supabaseClient";

type ScanViewResult = {
  productCode: string;
  imageUrl?: string;
};

type Mode = "home" | "scan" | "inventory";

type Adjustment = {
  id: number;
  delta: number;
  reason: string | null;
  note: string | null;
  created_at: string;
};

const TABLE = "products_catalog";
const BUCKET = "product-images";
const ADJUSTMENTS_TABLE = "inventory_adjustments_test";
const REASONS: { label: string; value: string }[] = [
  { label: "Monthly Cycle Count", value: "monthly_cycle_count" },
  { label: "Initial Count", value: "initial_count" },
  { label: "Sale", value: "sale" },
  { label: "Damage", value: "damage" },
];


// Your sandbox inventory table + RPC
const ON_HAND_TABLE = "inventory_on_hand_test";
const ADJUST_RPC = "adjust_inventory_test";

function normalizeProductCode(input: string) {
  const trimmed = input.trim();
  const lastSegment = trimmed.includes("/")
    ? trimmed.split("/").pop() ?? trimmed
    : trimmed;
  const clean = lastSegment.split("?")[0].split("#")[0];

  return clean
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, "")
    .replace(/\.(png|jpg|jpeg|webp)$/i, "");
}

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [mode, setMode] = useState<Mode>("home");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  // Shared scan state
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const qrRef = useRef<Html5Qrcode | null>(null);
  const regionId = "qr-reader";

  // Scan mode output
  const [scanViewResult, setScanViewResult] = useState<ScanViewResult | null>(
    null
  );

  // Inventory mode state
  const [invProductCode, setInvProductCode] = useState<string | null>(null);
  const [invOnHand, setInvOnHand] = useState<number | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invAdjustments, setInvAdjustments] = useState<Adjustment[]>([]);



  const [invDelta, setInvDelta] = useState<number>(0); // signed integer
  const [invReason, setInvReason] = useState<string>("monthly_cycle_count");
  const [invNote, setInvNote] = useState<string>("");
  const [invSuccess, setInvSuccess] = useState<string | null>(null);
  const [invImageUrl, setInvImageUrl] = useState<string | null>(null);

  // Online offline 
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);

  // ---------- Brand + UI tokens ----------
  const appBg = "bg-[#FBF7F6]";
  const textMain = "text-[#111111]";
  const textMuted = "text-[#5B4B4B]";
  const borderWarm = "border border-[#E8D9D9]";
  const surface = `bg-white ${borderWarm} shadow-sm rounded-2xl`;

  const btnPrimary =
    "w-full rounded-xl px-4 py-2 font-medium text-white bg-[#2B0909] active:scale-[0.99] disabled:opacity-60";

  const btnBlue =
    "w-full rounded-xl px-4 py-2 font-semibold text-white bg-[#2563EB] active:scale-[0.99] disabled:opacity-60"; // neutral blue

  const btnSecondary =
    "w-full rounded-xl px-4 py-2 font-medium bg-white text-[#2B0909] border border-[#E8D9D9] active:scale-[0.99]";

  const btnChip =
    "rounded-xl px-3 py-2 text-sm font-medium bg-white text-[#2B0909] border border-[#E8D9D9] active:scale-[0.99]";

  const inputStyle =
    "w-full rounded-xl px-3 py-2 bg-white text-[#111111] border border-[#E8D9D9] placeholder:text-[#8A7B7B]";

  // ---------- Auth ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIsAuthenticated(!!data.session);
      setSessionChecked(true);
      setMode("home");
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      if (!session) setMode("home");
    });

    return () => {
      sub.subscription.unsubscribe();
      stopScan();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const handleLogin = async () => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });
    if (error) setAuthError(error.message);
    else setMode("home");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setEmail("");
    setPassword("");
    resetAllWorkflows();
    await stopScan();
  };

  const resetAllWorkflows = () => {
    setMode("home");
    setScanError(null);
    setScanViewResult(null);

    setInvProductCode(null);
    setInvOnHand(null);
    setInvLoading(false);
    setInvDelta(0);
    setInvReason("monthly_cycle_count");
    setInvNote("");
    setInvSuccess(null);
    setInvImageUrl(null);

    setInvAdjustments([]);
  };

  // ---------- Scanning ----------
  const stopScan = async () => {
    try {
      if (qrRef.current && qrRef.current.isScanning) {
        await qrRef.current.stop();
        await qrRef.current.clear();
      }
    } catch {
      // ignore
    } finally {
      setIsScanning(false);
    }
  };

  const startScan = async () => {
    setScanError(null);
    setInvSuccess(null);
    setIsScanning(true);

    try {
      if (!qrRef.current) qrRef.current = new Html5Qrcode(regionId);

      await qrRef.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          const productCode = normalizeProductCode(decodedText);

          if (mode === "scan") {
            await handleScanMode(productCode);
          } else if (mode === "inventory") {
            await handleInventoryModeScan(productCode);
          }

          await stopScan();
        },
        () => {}
      );
    } catch (e: any) {
      setScanError(e?.message || "Could not start camera.");
      setIsScanning(false);
    }
  };

  const handleScanMode = async (productCode: string) => {
    setScanViewResult(null);

    const { data, error } = await supabase
      .from(TABLE)
      .select("product_code,image_path")
      .eq("product_code", productCode)
      .single();

    if (error || !data) {
      setScanError(
        `Lookup failed for ${productCode}:\n` +
          `${error?.message ?? "no data returned"}`
      );
      setScanViewResult({ productCode });
      return;
    }

    if (!data.image_path) {
      setScanError(`Found ${productCode} but no image_path in table.`);
      setScanViewResult({ productCode: data.product_code ?? productCode });
      return;
    }

    const { data: pub } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(data.image_path);

    setScanViewResult({
      productCode: data.product_code ?? productCode,
      imageUrl: pub.publicUrl,
    });
  };

  const handleInventoryModeScan = async (productCode: string) => {
    setInvProductCode(productCode);
    setInvDelta(0);
    setInvSuccess(null);
    setScanError(null);
    setInvLoading(true);
    setInvOnHand(null);
    setInvImageUrl(null);
    setInvAdjustments([]);



    // 1) Confirm product exists (optional but helpful)
    const { data: prod, error: prodErr } = await supabase
      .from(TABLE)
      .select("product_code")
      .eq("product_code", productCode)
      .maybeSingle();

    if (prodErr) {
      setScanError(`Product check failed: ${prodErr.message}`);
      setInvLoading(false);
      return;
    }
    if (!prod) {
      setScanError(`No product found for: ${productCode}`);
      setInvLoading(false);
      return;
    }
    // 2) Fetch product image
    const { data: imgRow, error: imgErr } = await supabase
      .from(TABLE)
      .select("image_path")
      .eq("product_code", productCode)
      .maybeSingle();

    if (imgErr) {
      setScanError(`Image lookup failed: ${imgErr.message}`);
      setInvLoading(false);
      return;
    }

    if (imgRow?.image_path) {
      const { data: pub } = supabase.storage
        .from(BUCKET)
        .getPublicUrl(imgRow.image_path);

      setInvImageUrl(pub.publicUrl);
    } else {
      setInvImageUrl(null);
    }

    // 3) Load current on-hand (if missing row -> treat as 0)
    const { data: invRow, error: invErr } = await supabase
      .from(ON_HAND_TABLE)
      .select("on_hand")
      .eq("product_code", productCode)
      .maybeSingle();

    if (invErr) {
      setScanError(`On-hand lookup failed: ${invErr.message}`);
      setInvLoading(false);
      return;
    }
    // 4) Load last 3 adjustments
    const { data: adjRows, error: adjErr } = await supabase
      .from(ADJUSTMENTS_TABLE)
      .select("id,delta,reason,note,created_at")
      .eq("product_code", productCode)
      .order("created_at", { ascending: false })
      .limit(3);

    if (adjErr) {
      setScanError(`Adjustment history failed: ${adjErr.message}`);
      setInvAdjustments([]);
    } else {
      setInvAdjustments((adjRows ?? []) as Adjustment[]);
    }

    setInvOnHand(invRow?.on_hand ?? 0);
    setInvLoading(false);
  };

  // ---------- Inventory adjustment ----------
  const previewColor =
    invDelta >= 0 ? "text-[#15803D]" : "text-[#B91C1C]"; // green/red

  const previewText =
    invDelta >= 0 ? `+${invDelta}` : `${invDelta}`;

  const resultingOnHand = useMemo(() => {
    if (invOnHand == null) return null;
    return invOnHand + invDelta;
  }, [invOnHand, invDelta]);

  const canSubmit =
    !!invProductCode && invOnHand != null && invDelta !== 0 && !invLoading;

  const submitAdjustment = async () => {
    setScanError(null);
    setInvSuccess(null);

    if (!canSubmit || !invProductCode) return;

    const { error } = await supabase.rpc(ADJUST_RPC, {
      p_product_code: invProductCode,
      p_delta: invDelta,
      p_reason: invReason || null,
      p_note: invNote || null,
    });

    if (error) {
      setScanError(`Adjustment failed: ${error.message}`);
      return;
    }

    // Refresh on-hand after submit
    const { data: invRow, error: invErr } = await supabase
      .from(ON_HAND_TABLE)
      .select("on_hand")
      .eq("product_code", invProductCode)
      .maybeSingle();

    if (invErr) {
      setScanError(`Adjustment saved, but refresh failed: ${invErr.message}`);
      return;
    }

    setInvOnHand(invRow?.on_hand ?? 0);
    setInvDelta(0);
    setInvSuccess("Inventory updated.");

    const { data: adjRows, error: adjErr } = await supabase
      .from(ADJUSTMENTS_TABLE)
      .select("id,delta,reason,note,created_at")
      .eq("product_code", invProductCode)
      .order("created_at", { ascending: false })
      .limit(3);

    if (!adjErr) setInvAdjustments((adjRows ?? []) as Adjustment[]);
  };

  // ---------- Render ----------
  if (!sessionChecked) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center p-4 ${appBg} ${textMain}`}
      >
        <div className={`text-sm ${textMuted}`}>Loading…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div
        className={`min-h-screen flex items-center justify-center p-4 ${appBg} ${textMain}`}
      >
        <div className={`w-full max-w-sm p-5 space-y-3 ${surface}`}>
          <h2 className="text-xl font-semibold">Sign in</h2>

          <input
            className={inputStyle}
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <input
            className={inputStyle}
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button className={btnPrimary} onClick={handleLogin}>
            Continue
          </button>

          {authError && (
            <p className="text-sm text-[#B42318] whitespace-pre-line">
              {authError}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen p-4 ${appBg} ${textMain}`}>
      <div className="max-w-md mx-auto space-y-4">
        {/* Top bar */}
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${
              isOnline ? "bg-[#16A34A]" : "bg-[#DC2626]"
            }`}
          />
          <span className="text-xs text-[#5B4B4B]">
            {isOnline ? "Online" : "Offline"}
          </span>
        </div>        
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">
            {mode === "scan"
              ? "Scan product"
              : mode === "inventory"
              ? "Inventory adjust"
              : "Inventory app"}
          </h1>

          <div className="flex items-center gap-2">
            {mode !== "home" && (
              <button
                className={btnChip}
                onClick={async () => {
                  await stopScan();
                  resetAllWorkflows();
                }}
              >
                Back
              </button>
            )}
            <button className={btnChip} onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>

        {/* Home menu */}
        {mode === "home" && (
          <div className={`p-5 space-y-3 ${surface}`}>
            <button
              className={btnPrimary}
              onClick={() => {
                resetAllWorkflows();
                setMode("scan");
              }}
            >
              Scan mode (view product)
            </button>
            <button
              className={btnBlue}
              onClick={() => {
                resetAllWorkflows();
                setMode("inventory");
              }}
            >
              Inventory mode (adjust counts)
            </button>
            <p className={`text-sm ${textMuted}`}>
              Use scan mode to view photos. Use inventory mode to apply +/- deltas
              (and log monthly cycle checks).
            </p>
          </div>
        )}

        {/* Shared scan panel */}
        {(mode === "scan" || mode === "inventory") && (
          <div className={`p-5 space-y-3 ${surface}`}>
            <button
              className={btnPrimary}
              onClick={startScan}
              disabled={isScanning}
            >
              {isScanning ? "Scanning…" : "Open camera & scan QR"}
            </button>

            {isScanning && (
              <button className={btnSecondary} onClick={stopScan}>
                Stop scanning
              </button>
            )}

            <div id={regionId} className="w-full overflow-hidden rounded-xl" />

            {scanError && (
              <p className="text-sm text-[#B42318] whitespace-pre-line">
                {scanError}
              </p>
            )}
          </div>
        )}

        {/* Scan mode result */}
        {mode === "scan" && scanViewResult && (
          <div className={`p-5 space-y-3 ${surface}`}>
            <div className={`text-sm ${textMuted}`}>Product code</div>
            <div className="text-lg font-semibold">
              {scanViewResult.productCode}
            </div>

            {scanViewResult.imageUrl && (
              <img
                src={scanViewResult.imageUrl}
                alt="Product"
                className="w-full rounded-xl border border-[#E8D9D9]"
              />
            )}
          </div>
        )}

        {/* Inventory mode panel */}
        {mode === "inventory" && (
          <div className={`p-5 space-y-4 ${surface}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className={`text-sm ${textMuted}`}>Product code</div>
                <div className="text-lg font-semibold">
                  {invProductCode ?? "Scan a product to begin"}
                </div>
              </div>

              <div className="text-right">
                <div className={`text-sm ${textMuted}`}>On hand</div>
                <div className="text-2xl font-semibold">
                  {invLoading ? "…" : invOnHand ?? "—"}
                </div>
              </div>
            </div>
            {invImageUrl && (
              <img
                src={invImageUrl}
                alt="Product"
                className="w-full rounded-xl border border-[#E8D9D9]"
              />
            )}
            {/* Last 3 adjustments */}
            {invProductCode && (
              <div className="rounded-xl border border-[#E8D9D9] bg-white p-3">
                <div className="text-sm font-semibold text-[#111111]">
                  Recent adjustments
                </div>

                {invAdjustments.length === 0 ? (
                  <div className="text-sm text-[#5B4B4B] mt-1">
                    No adjustments yet.
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {invAdjustments.map((a) => {
                      const isAdd = a.delta >= 0;
                      const deltaText = isAdd ? `+${a.delta}` : `${a.delta}`;
                      const deltaClass = isAdd ? "text-[#15803D]" : "text-[#B91C1C]";
                      const when = new Date(a.created_at).toLocaleString();

                      return (
                        <div
                          key={a.id}
                          className="flex items-start justify-between gap-3 border-t border-[#F1E7E7] pt-2 first:border-t-0 first:pt-0"
                        >
                          <div className="min-w-0">
                            <div className="text-sm text-[#111111]">
                              {a.reason ?? "—"}
                            </div>
                            {a.note ? (
                              <div className="text-xs text-[#5B4B4B] truncate">
                                {a.note}
                              </div>
                            ) : null}
                            <div className="text-xs text-[#8A7B7B]">{when}</div>
                          </div>

                          <div className={`text-sm font-semibold ${deltaClass}`}>
                            {deltaText}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tap counter + preview */}
            <div className="grid grid-cols-3 gap-2 items-end">
              {/* Minus */}
              <button
                type="button"
                className="rounded-xl px-3 py-3 text-xl font-semibold bg-[#FDECEC] border border-[#FCA5A5] text-[#7F1D1D] active:scale-[0.97]"
                onClick={() => setInvDelta((d) => Math.min(d - 1, 0))}
              >
                –
              </button>

              {/* Preview */}
              <div className="rounded-xl border border-[#E8D9D9] bg-white px-3 py-2 text-center">
                <div className={`text-2xl font-bold ${previewColor}`}>{previewText}</div>
                <div className="text-[11px] text-[#5B4B4B]">
                  {invOnHand == null ? "result —" : `result ${resultingOnHand}`}
                </div>
              </div>

              {/* Plus */}
              <button
                type="button"
                className="rounded-xl px-3 py-3 text-xl font-semibold bg-[#EAF6EF] border border-[#86EFAC] text-[#166534] active:scale-[0.97]"
                onClick={() => setInvDelta((d) => Math.max(d + 1, 0))}
              >
                +
              </button>
            </div>


            {/* Reason + Note */}
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-1">
                <div className={`text-xs ${textMuted} mb-1`}>Reason</div>
                <select
                  className={inputStyle}
                  value={invReason}
                  onChange={(e) => setInvReason(e.target.value)}
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-1">
                <div className={`text-xs ${textMuted} mb-1`}>Note</div>
                <input
                  className={inputStyle}
                  value={invNote}
                  onChange={(e) => setInvNote(e.target.value)}
                  placeholder="Optional"
                />
              </div>
            </div>

            {/* Submit */}
            <button
              className={btnBlue}
              onClick={submitAdjustment}
              disabled={!canSubmit}
            >
              Confirm change
            </button>

            {invSuccess && (
              <p className="text-sm text-[#166534] whitespace-pre-line">
                {invSuccess}
              </p>
            )}

            <div className={`text-xs ${textMuted}`}>
              Tip: For monthly cycle checks, keep reason as{" "}
              <span className="font-medium">monthly_cycle_count</span> and write
              your counted details in Note.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
