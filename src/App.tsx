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

const LOCATIONS_TABLE = "locations_test";
const LOC_ON_HAND_TABLE = "inventory_on_hand_by_location_test";
const MOVE_RPC = "move_inventory_test";
const MOVEMENTS_TABLE = "inventory_movements_test"; // optional if you want to show recent moves



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

function reasonLabel(value: string | null | undefined) {
  const found = REASONS.find((r) => r.value === value);
  return found?.label ?? (value ?? "—");
}

function isValidProductCodeFormat(code: string) {
  // 4 dash-separated segments, 1–6 alphanumeric each
  // ex: RB-10-02-16
  return /^[A-Za-z0-9]{1,6}(-[A-Za-z0-9]{1,6}){3}$/.test(code);
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

  // Inventory mode state
  const [invError, setInvError] = useState<string | null>(null);   // inventory actions (adjust/move)
  const [invProductCode, setInvProductCode] = useState<string | null>(null);
  const [invOnHand, setInvOnHand] = useState<number | null>(null);
  const [invLoading, setInvLoading] = useState(false);
  const [invAdjustments, setInvAdjustments] = useState<Adjustment[]>([]);
  const [invEntry, setInvEntry] = useState<"scan" | "search">("search");



  const [invDelta, setInvDelta] = useState<number>(0); // signed integer
  const [invReason, setInvReason] = useState<string>("monthly_cycle_count");
  const [invNote, setInvNote] = useState<string>("");
  const [invSuccess, setInvSuccess] = useState<string | null>(null);
  const [invImageUrl, setInvImageUrl] = useState<string | null>(null);

  const [invSearchCode, setInvSearchCode] = useState("");
  const [invSearchError, setInvSearchError] = useState<string | null>(null);
  const [invSearchBusy, setInvSearchBusy] = useState(false);

  const [invAction, setInvAction] = useState("adjust"); // "adjust" | "move"


  // New tabs within inventory mode 2-16-2026
  type MovementType = "receive" | "send" | "transfer" | "adjust";
  const [movementType, setMovementType] = useState<MovementType>("receive");

  const [adjustLoc, setAdjustLoc] = useState("");
  const [receiveToLoc, setReceiveToLoc] = useState("");
  const [receiveQty, setReceiveQty] = useState(1);
  const [sendFromLoc, setSendFromLoc] = useState("");
  const [sendQty, setSendQty] = useState(1);

  const submitReceive = () => setInvError("submitReceive not implemented yet");
  const submitSend = () => setInvError("submitSend not implemented yet");







  // Location tracking 
  const [locBalances, setLocBalances] = useState<{
    location_id: string;
    on_hand: number;
    location_code?: string;
  }[]>([]);

  const [fromLoc, setFromLoc] = useState<string>("");
  const [toLoc, setToLoc] = useState<string>("");
  const [moveQty, setMoveQty] = useState<number>(1);

  type Location = {
    id: string;
    location_code: string;
  };
  const [locations, setLocations] = useState<Location[]>([]);

  // Movement tracking

  type Movement = {
    id: number;
    qty: number;
    note: string | null;
    created_at: string;
    from_location_id: string;
    to_location_id: string;
    from_location?: { location_code: string } | null;
    to_location?: { location_code: string } | null;
  };

  const [invMoves, setInvMoves] = useState<Movement[]>([]);


  // Scan mode output
  const [scanViewResult, setScanViewResult] = useState<ScanViewResult | null>(
    null
  );

  // flag state for Scan mode
  const [autoStartMode, setAutoStartMode] = useState<"scan" | "inventory" | null>(null);

  // handles Scan mode scan after render
  useEffect(() => {
    if (!autoStartMode) return;
    if (mode !== autoStartMode) return;

    // Wait until the DOM has painted so #qr-reader exists
    const id = requestAnimationFrame(() => {
      startScan(autoStartMode);
      setAutoStartMode(null);
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartMode, mode]);

  // handle the Move/Adjust options within Inventory mode
  useEffect(() => {
    if (mode !== "inventory") return;

    const loadLocations = async () => {
      const { data, error } = await supabase
        .from(LOCATIONS_TABLE)
        .select("id, location_code")
        .order("location_code", { ascending: true });

      if (error) {
        console.error("locations load error", error);
        setLocations([]);
        return;
      }
      setLocations(data ?? []);
    };

    loadLocations();
  }, [mode]);

  useEffect(() => {
    if (mode !== "inventory") return;
    if (!invProductCode) {
      setLocBalances([]);
      return;
    }
    if (invAction !== "move") return;

    const loadLocBalances = async () => {
      // If your LOC_ON_HAND_TABLE already includes location_code, use it directly:
      const { data, error } = await supabase
        .from(LOC_ON_HAND_TABLE)
        .select("location_id, on_hand, locations_test(location_code)")
        .eq("product_code", invProductCode)
        .order("on_hand", { ascending: false });

      if (!error) {
        setLocBalances(
          (data ?? []).map((r: any) => ({
            location_id: r.location_id,
            on_hand: r.on_hand,
            location_code: r.locations_test?.location_code ?? r.location_id,
          }))
        );
      }
    };

    loadLocBalances();
  }, [mode, invProductCode, invAction]);


  // Handle inventory search
  const handleInventorySearch = async () => {
      setInvSearchError(null);
      setInvSuccess(null);

      const raw = invSearchCode.trim();
      if (!raw) {
        setInvSearchError('Please enter a product code (e.g. "RB-10-02-16").');
        return;
      }

      const productCode = normalizeProductCode(raw);

      if (!isValidProductCodeFormat(productCode)) {
        setInvSearchError(
          'Invalid format. Use "color-shape-pattern-size" like RB-10-02-16.'
        );
        return;
      }

      setInvSearchBusy(true);
      try {
        // Quick existence check for clean feedback (optional but nice)
        const { data, error } = await supabase
          .from(TABLE)
          .select("product_code")
          .eq("product_code", productCode)
          .maybeSingle();

        if (error) {
          setInvSearchError(`Search failed: ${error.message}`);
          return;
        }

        if (!data) {
          setInvSearchError(`No product found for: ${productCode} -- Product might exist but not registered.`);
          return;
        }

        // Reuse the exact same flow as QR scan (loads on-hand, image, last 3, etc.)
        await handleInventoryModeScan(productCode);
        await loadRecentMoves(productCode);
      } finally {
        setInvSearchBusy(false);
      }
    };

  // Online offline 
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);

  // ---------- Brand + UI tokens ----------
  const appBg = "bg-[#FBF7F6]";
  const textMain = "text-[#111111]";
  const textMuted = "text-[#5B4B4B]";
  const borderWarm = "border border-[#E8D9D9]";
  const surface =
    "bg-white border-2 border-[#E0CACA] shadow-sm rounded-2xl";

  const btnPrimary =
    "w-full rounded-xl px-4 py-2 font-medium text-white " +
    "bg-[#2B0909] border-2 border-[#2B0909] " +
    "hover:bg-[#3A0F0F] active:scale-[0.98] " +
    "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2B0909] " +
    "disabled:opacity-60 transition";

  const btnBlue =
    "w-full rounded-xl px-4 py-2 font-semibold text-white bg-[#2563EB] active:scale-[0.99] disabled:opacity-60"; // neutral blue

  const btnSecondary =
    "w-full rounded-xl px-4 py-2 font-medium " +
    "bg-white text-[#2B0909] border-2 border-[#2B0909] " +
    "hover:bg-[#FBF2F2] active:scale-[0.98] " +
    "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2B0909] " +
    "transition";

  const btnChip =
    "rounded-xl px-3 py-2 text-sm font-medium bg-white text-[#2B0909] border border-[#E8D9D9] active:scale-[0.99]";

  const inputStyle =
    "w-full rounded-xl px-3 py-2 bg-white text-[#111111] " +
    "border-2 border-[#C9B6B6] " +
    "focus:outline-none focus:ring-2 focus:ring-[#2B0909] focus:border-[#2B0909] " +
    "hover:border-[#9F7A7A] transition";

  const btnToggleActive =
    "w-full rounded-xl px-4 py-2 font-semibold " +
    "bg-[#2B0909] text-white " +
    "border-2 border-[#2B0909] " +
    "focus:outline-none focus:ring-2 focus:ring-[#2B0909]";

  const btnToggleInactive =
    "w-full rounded-xl px-4 py-2 font-medium " +
    "bg-white text-[#2B0909] " +
    "border-2 border-[#C9B6B6] " +
    "hover:border-[#2B0909] " +
    "focus:outline-none focus:ring-2 focus:ring-[#2B0909]";



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

    setInvSearchCode("");
    setInvSearchError(null);
    setInvSearchBusy(false);
    setInvEntry("search");
    setInvMoves([]);


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

  const startScan = async (targetMode: "scan" | "inventory") => {
    setScanError(null);
    setInvSuccess(null);
    setIsScanning(true);
    const el = document.getElementById(regionId);
    if (!el) {
      setScanError("Scanner UI not ready yet. Please try again.");
      setIsScanning(false);
      return;
    }

    try {
      const nodes = document.querySelectorAll(`#${regionId}`);
      console.log("qr-reader nodes:", nodes.length, nodes);

      if (!qrRef.current) qrRef.current = new Html5Qrcode(regionId);

      await qrRef.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        async (decodedText) => {
          const productCode = normalizeProductCode(decodedText);

          if (targetMode === "scan") {
            await handleScanMode(productCode);
          } else {
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
    setInvSearchError(null);
    setInvSearchCode(productCode);
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

    await loadRecentMoves(productCode);

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
    setInvError(null);
    setInvSuccess(null);

    if (!canSubmit || !invProductCode) return;

    const { error } = await supabase.rpc(ADJUST_RPC, {
      p_product_code: invProductCode,
      p_delta: invDelta,
      p_reason: invReason || null,
      p_note: invNote || null,
    });

    if (error) {
      setInvError(`Adjustment failed: ${error.message}`);
      return;
    }

    // Refresh on-hand after submit
    const { data: invRow, error: invErr } = await supabase
      .from(ON_HAND_TABLE)
      .select("on_hand")
      .eq("product_code", invProductCode)
      .maybeSingle();

    if (invErr) {
      setInvError(`Adjustment saved, but refresh failed: ${invErr.message}`);
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

  // Moving inventory

  const submitMove = async () => {
    setInvError(null);
    setInvSuccess(null);

    if (!invProductCode) return;

    if (!fromLoc || !toLoc) {
      setInvError("Move failed: select both From and To locations.");
      return;
    }
    if (fromLoc === toLoc) {
      setInvError("Move failed: From and To locations must be different.");
      return;
    }
    if (!moveQty || moveQty <= 0) {
      setInvError("Move failed: quantity must be at least 1.");
      return;
    }

    const { error } = await supabase.rpc(MOVE_RPC, {
      p_product_code: invProductCode,
      p_from_location_id: fromLoc, // string
      p_to_location_id: toLoc, //string
      p_qty: moveQty,
      p_note: invNote || null,
    });

    if (error) {
      setInvError(`Move failed: ${error.message}`);
      return;
    }

    // Refresh TOTAL on-hand (transfer should not change it, but keep UI synced)
    const { data: invRow, error: invErr } = await supabase
      .from(ON_HAND_TABLE)
      .select("on_hand")
      .eq("product_code", invProductCode)
      .maybeSingle();

    if (invErr) {
      setInvError(`Move saved, but refresh failed: ${invErr.message}`);
      return;
    }

    setInvOnHand(invRow?.on_hand ?? 0);
    setInvSuccess("Inventory moved.");

    // Refresh per-location balances for this product
    const { data, error: locErr } = await supabase
      .from(LOC_ON_HAND_TABLE)
      .select("location_id, on_hand, locations_test(location_code)")
      .eq("product_code", invProductCode)
      .order("on_hand", { ascending: false });

    if (locErr) {
      console.error("loc refresh error", locErr);
    } else {
      setLocBalances(
        (data ?? []).map((r: any) => ({
          location_id: r.location_id,
          on_hand: r.on_hand,
          location_code: r.locations_test?.location_code ?? r.location_id,
        }))
      );
    }
    await loadRecentMoves(invProductCode);

    // Reset move fields
    setMoveQty(1);
    setFromLoc("");
    setToLoc("");
  };

  // Loading Recent Moving History 
  const loadRecentMoves = async (productCode: string) => {
    const { data, error } = await supabase
      .from(MOVEMENTS_TABLE)
      .select(`
        id,
        quantity,
        note,
        created_at,
        from_location_id,
        to_location_id,
        from_location:locations_test!inventory_movements_test_from_location_id_fkey(location_code),
        to_location:locations_test!inventory_movements_test_to_location_id_fkey(location_code)
      `)
      .eq("product_code", productCode)
      .order("created_at", { ascending: false })
      .limit(3);

    if (error) {
      console.error("move history failed:", error);
      setInvMoves([]);
      return;
    }

    setInvMoves((data ?? []) as Movement[]);
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
          <div className="flex flex-col items-center gap-3 mb-2">
            <div className="w-64 h-64 rounded-2xl overflow-hidden bg-white border border-[#E8D9D9]">
              <img
                src="/logo.JPEG"
                alt="Company logo"
                className="w-full h-full object-cover scale-110"
              />
            </div>

            <h2 className="text-xl font-semibold text-[#2B0909]">
              Sign in
            </h2>
            <p className="text-xs text-[#5B4B4B] text-center">
              Inventory management
            </p>
          </div>

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
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white border border-[#E8D9D9]">
          <img
            src="/logo.JPEG"
            alt="Company logo"
            className="w-10 h-10 object-contain"
          />

          <div className="flex-1">
            <div className="text-base font-semibold text-[#2B0909]">
              Inventory Manager
            </div>
            <div className="text-xs text-[#5B4B4B]">
              Scan • Search • Adjust
            </div>
          </div>
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
                setAutoStartMode("scan");
              }}
            >
              Lookup (view product)
            </button>
            <button
              className={btnPrimary}
              onClick={() => {
                resetAllWorkflows();
                setMode("inventory");
                setInvEntry("search");
              }}
            >
              Inventory Movements (adjust counts)
            </button>
            <p className={`text-sm ${textMuted}`}>
              Use Lookup to preview product photos. Use Inventory Movements to adjust levels
              (and log monthly cycle checks).
            </p>
          </div>
        )}

        {/* Shared scan panel */}
        {(mode === "scan" || (mode === "inventory" && invEntry === "scan")) &&  (
          <div className={`p-5 space-y-3 ${surface}`}>
            <button
              className={btnPrimary}
              onClick={() => startScan(mode === "inventory" ? "inventory" : "scan")}
              disabled={isScanning}
            >
              {isScanning ? "Scanning…" : "Open camera & scan QR"}
            </button>

            {isScanning && (
              <button className={btnSecondary} onClick={stopScan}>
                Stop scanning
              </button>
            )}

            <div id={regionId} className="w-full overflow-hidden rounded-xl min-h-[260px]" />

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
          <div className="space-y-4">
            {/* --- Top: two input containers --- */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Manual lookup container */}
              <div className={`p-5 space-y-3 ${surface}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-base font-semibold">Manual lookup</div>
                    <div className={`text-xs ${textMuted}`}>
                      Enter a product code like RB-10-02-16
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    className={inputStyle}
                    value={invSearchCode}
                    onChange={(e) => {
                      setInvSearchCode(e.target.value);
                      setInvSearchError(null);
                    }}
                    placeholder="RB-10-02-16"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleInventorySearch();
                    }}
                  />

                  <button
                    type="button"
                    className={btnSecondary}
                    onClick={handleInventorySearch}
                    disabled={invSearchBusy}
                  >
                    {invSearchBusy ? "Searching…" : "Search"}
                  </button>
                </div>

                {invSearchError && (
                  <p className="text-sm text-[#B42318] whitespace-pre-line">
                    {invSearchError}
                  </p>
                )}
              </div>

              {/* Camera scan container */}
              <div className={`p-5 space-y-3 ${surface}`}>
                <div>
                  <div className="text-base font-semibold">Camera scan</div>
                  <div className={`text-xs ${textMuted}`}>
                    Scan the QR label to load the product
                  </div>
                </div>

                <button
                  className={btnPrimary}
                  onClick={() => startScan("inventory")}
                  disabled={isScanning}
                  type="button"
                >
                  {isScanning ? "Scanning…" : "Open camera & scan QR"}
                </button>

                {isScanning && (
                  <button className={btnSecondary} onClick={stopScan} type="button">
                    Stop scanning
                  </button>
                )}

                {/* Keep this always mounted in inventory mode for scanning */}
                <div id={regionId} className="w-full overflow-hidden rounded-xl" />

                {scanError && (
                  <p className="text-sm text-[#B42318] whitespace-pre-line">
                    {scanError}
                  </p>
                )}
              </div>
            </div>

            {/* --- Below: product details & adjustments (only after product selected) --- */}
            {invProductCode ? (
              <div className={`p-5 space-y-4 ${surface}`}>
                {/* Header row */}
                <div className={`text-xs ${textMuted}`}>
                  {movementType === "adjust" && "Adjust on-hand at a location (damage, recount, corrections)."}
                  {movementType === "receive" && "Receive stock into a location (adds on-hand)."}
                  {movementType === "send" && "Send stock out from a location (removes on-hand)."}
                  {movementType === "transfer" && "Move stock between locations (total on-hand stays the same)."}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`text-sm ${textMuted}`}>Product code</div>
                    <div className="text-lg font-semibold">{invProductCode}</div>
                  </div>

                  <div className="text-right">
                    <div className={`text-sm ${textMuted}`}>On hand</div>
                    <div className="text-2xl font-semibold">
                      {invLoading ? "…" : invOnHand ?? "—"}
                    </div>
                  </div>
                </div>
                {/* Movement tabs switch */}
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    className={movementType === "receive" ? btnToggleActive : btnToggleInactive}
                    onClick={() => { setMovementType("receive"); setInvError(null); setInvSuccess(null); }}
                  >
                    Receive
                  </button>

                  <button
                    type="button"
                    className={movementType === "send" ? btnToggleActive : btnToggleInactive}
                    onClick={() => { setMovementType("send"); setInvError(null); setInvSuccess(null); }}
                  >
                    Send
                  </button>

                  <button
                    type="button"
                    className={movementType === "transfer" ? btnToggleActive : btnToggleInactive}
                    onClick={() => { setMovementType("transfer"); setInvError(null); setInvSuccess(null); }}
                  >
                    Transfer
                  </button>

                  <button
                    type="button"
                    className={movementType === "adjust" ? btnToggleActive : btnToggleInactive}
                    onClick={() => { setMovementType("adjust"); setInvError(null); setInvSuccess(null); }}
                  >
                    Adjust
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <div className={`text-xs ${textMuted} mb-1`}>Location</div>
                    <select className={inputStyle} value={adjustLoc} onChange={(e) => setAdjustLoc(e.target.value)}>
                      <option value="">Select location</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>{l.location_code}</option>
                      ))}
                    </select>
                  </div>
                </div>


                {/* Image */}
                {invImageUrl && (
                  <img
                    src={invImageUrl}
                    alt="Product"
                    className="w-full rounded-xl border border-[#E8D9D9]"
                  />
                )}

                {movementType === "adjust" && (
                  <>
                    {/* Last 3 adjustments */}
                    <div className="rounded-xl border border-[#E8D9D9] bg-white p-3">
                      <div className="text-sm font-semibold text-[#111111]">
                        Recent adjustments
                      </div>

                      {invAdjustments.length === 0 ? (
                        <div className="text-sm text-[#5B4B4B] mt-1">No adjustments yet.</div>
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
                                    {reasonLabel(a.reason)}
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

                    {/* Tap counter + preview */}
                    <div className="grid grid-cols-3 gap-2 items-end">
                      <button
                        type="button"
                        className="rounded-xl px-3 py-3 text-xl font-semibold bg-[#FDECEC] border border-[#FCA5A5] text-[#7F1D1D] active:scale-[0.97]"
                        onClick={() => setInvDelta((d) => Math.min(d - 1, 0))}
                      >
                        –
                      </button>

                      <div className="rounded-xl border border-[#E8D9D9] bg-white px-3 py-2 text-center">
                        <div className={`text-2xl font-bold ${previewColor}`}>
                          {previewText}
                        </div>
                        <div className="text-[11px] text-[#5B4B4B]">
                          {invOnHand == null ? "result —" : `result ${resultingOnHand}`}
                        </div>
                      </div>

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
                    <button className={btnBlue} onClick={submitAdjustment} disabled={!canSubmit}>
                      Confirm change
                    </button>
                  </>
                )}
                
                {movementType === "receive" && (
                  <div className="space-y-3">
                    <div>
                      <div className={`text-xs ${textMuted} mb-1`}>To location</div>
                      <select
                        className={inputStyle}
                        value={receiveToLoc}
                        onChange={(e) => setReceiveToLoc(e.target.value)}
                        disabled={locations.length === 0}
                      >
                        <option value="">Select location</option>
                        {locations.map((l) => (
                          <option key={l.id} value={l.id}>{l.location_code}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <div className={`text-xs ${textMuted} mb-1`}>Quantity</div>
                      <input
                        className={inputStyle}
                        type="number"
                        min={1}
                        value={receiveQty}
                        onChange={(e) => setReceiveQty(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </div>

                    <button
                      className={btnBlue}
                      type="button"
                      onClick={submitReceive}  
                      disabled={!receiveToLoc || receiveQty < 1}
                    >
                      Confirm receive
                    </button>
                  </div>
                )}

                {movementType === "send" && (
                  <div className="space-y-3">
                    {/* Optional: show balances like your “Where it is” panel */}
                    <div className="rounded-xl border border-[#E8D9D9] bg-white p-3">
                      <div className="text-sm font-semibold text-[#111111]">Available by location</div>
                      {locBalances.length === 0 ? (
                        <div className="text-sm text-[#5B4B4B] mt-1">No stock recorded in any location.</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {locBalances
                            .filter((x) => x.on_hand > 0)
                            .sort((a, b) => b.on_hand - a.on_hand)
                            .map((x) => (
                              <div key={x.location_id} className="flex items-center justify-between">
                                <div className="text-sm text-[#111111]">{x.location_code ?? x.location_id}</div>
                                <div className="text-sm font-semibold">{x.on_hand}</div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className={`text-xs ${textMuted} mb-1`}>From location</div>
                      <select
                        className={inputStyle}
                        value={sendFromLoc}
                        onChange={(e) => setSendFromLoc(e.target.value)}
                        disabled={(locBalances ?? []).filter((x) => Number(x.on_hand ?? 0) > 0).length === 0}
                      >
                        <option value="">Select location</option>
                        {(locBalances ?? [])
                          .filter((x) => Number(x.on_hand ?? 0) > 0)
                          .sort((a, b) => Number(b.on_hand ?? 0) - Number(a.on_hand ?? 0))
                          .map((x) => (
                            <option key={x.location_id} value={x.location_id}>
                              {x.location_code ?? x.location_id} ({x.on_hand})
                            </option>
                          ))}
                      </select>
                    </div>

                    <div>
                      <div className={`text-xs ${textMuted} mb-1`}>Quantity</div>
                      <input
                        className={inputStyle}
                        type="number"
                        min={1}
                        value={sendQty}
                        onChange={(e) => setSendQty(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </div>

                    <button
                      className={btnBlue}
                      type="button"
                      onClick={submitSend}
                      disabled={!sendFromLoc || sendQty < 1}
                    >
                      Confirm send
                    </button>
                  </div>
                )}

                {movementType === "transfer" && (
                  <div className="space-y-3">
                    {/* Where it is now */}
                    <div className="rounded-xl border border-[#E8D9D9] bg-white p-3">
                      <div className="text-sm font-semibold text-[#111111]">Where it is</div>

                      {locBalances.length === 0 ? (
                        <div className="text-sm text-[#5B4B4B] mt-1">No stock recorded in any location.</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {locBalances
                            .filter((x) => x.on_hand > 0)
                            .sort((a, b) => b.on_hand - a.on_hand)
                            .map((x) => (
                              <div key={x.location_id} className="flex items-center justify-between">
                                <div className="text-sm text-[#111111]">{x.location_code ?? x.location_id}</div>
                                <div className="text-sm font-semibold">{x.on_hand}</div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Recent moves */}
                    <div className="rounded-xl border border-[#E8D9D9] bg-white p-3">
                      <div className="text-sm font-semibold text-[#111111]">Recent moves</div>

                      {invMoves.length === 0 ? (
                        <div className="text-sm text-[#5B4B4B] mt-1">No moves yet.</div>
                      ) : (
                        <div className="mt-2 space-y-2">
                          {invMoves.map((m) => {
                            const when = new Date(m.created_at).toLocaleString();
                            const fromCode = m.from_location?.location_code ?? m.from_location_id;
                            const toCode = m.to_location?.location_code ?? m.to_location_id;

                            return (
                              <div
                                key={m.id}
                                className="flex items-start justify-between gap-3 border-t border-[#F1E7E7] pt-2 first:border-t-0 first:pt-0"
                              >
                                <div className="min-w-0">
                                  <div className="text-sm text-[#111111]">
                                    (<span className="font-semibold">{m.quantity}</span>) {fromCode} → {toCode}
                                  </div>
                                  {m.note ? (
                                    <div className="text-xs text-[#5B4B4B] truncate">{m.note}</div>
                                  ) : null}
                                  <div className="text-xs text-[#8A7B7B]">{when}</div>
                                </div>

                                <div className="text-sm font-semibold text-[#111111]">
                                  {m.qty}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Move form */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* FROM */}
                      <div className="col-span-1">
                        <div className={`text-xs ${textMuted} mb-1`}>From</div>
                        <select
                          className={inputStyle}
                          value={fromLoc}
                          onChange={(e) => setFromLoc(e.target.value)}
                          disabled={(locBalances ?? []).filter((x) => Number(x.on_hand ?? 0) > 0).length === 0}
                        >
                          <option value="">Select location</option>

                          {(locBalances ?? [])
                            .filter((x) => Number(x.on_hand ?? 0) > 0)
                            .sort((a, b) => Number(b.on_hand ?? 0) - Number(a.on_hand ?? 0))
                            .map((x) => (
                              <option key={x.location_id} value={x.location_id}>
                                {x.location_code ?? x.location_id} ({x.on_hand})
                              </option>
                            ))}
                        </select>
                      </div>

                      {/* TO */}
                      <div className="col-span-1">
                        <div className={`text-xs ${textMuted} mb-1`}>To</div>

                        <select
                          className={inputStyle}
                          value={toLoc}
                          onChange={(e) => setToLoc(e.target.value)}
                          disabled={locations.length === 0}
                        >
                          <option value="">Select location</option>

                          {locations
                            .filter((l) => !fromLoc || l.id !== fromLoc) // optional: prevent choosing same as From
                            .map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.location_code}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>


                    <div>
                      <div className={`text-xs ${textMuted} mb-1`}>Quantity</div>
                      <input
                        className={inputStyle}
                        type="number"
                        min={1}
                        value={moveQty}
                        onChange={(e) => setMoveQty(Math.max(1, Number(e.target.value) || 1))}
                      />
                    </div>

                    <button
                      className={btnBlue}
                      type="button"
                      onClick={submitMove}
                      disabled={!fromLoc || !toLoc || fromLoc === toLoc || moveQty < 1}
                    >
                      Confirm move
                    </button>
                  </div>
                )}

                {invSuccess && (
                  <p className="text-sm text-[#166534] whitespace-pre-line">{invSuccess}</p>
                )}

                {invError && (
                  <p className="text-sm text-[#B42318] whitespace-pre-line">
                    {invError}
                  </p>
                )}

                {/* Space fillers */}
                <div className={`text-xs ${textMuted}`}>
                  Tip: For monthly cycle checks, keep reason as{" "}
                  <span className="font-medium">monthly_cycle_count</span> and write your
                  counted details in Note.
                </div>
              </div>
            ) : (
              <div className={`p-5 ${surface}`}>
                <div className={`text-sm ${textMuted}`}>
                  Scan a product or search to begin.
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

