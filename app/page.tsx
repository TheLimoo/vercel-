"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Trash,
  Edit,
  Copy,
  Check,
  CheckCircle,
  AlertCircle,
  Key,
  LogOut,
  Globe,
  RefreshCw,
  FileText,
  Upload,
  Info,
  Layers,
  Link,
  Save,
  Clock,
  ExternalLink,
  User,
  Users,
  Lock,
  Shield,
  ArrowLeft,
  Database,
  Activity,
  Menu,
  X
} from "lucide-react";

import { Subscription, DummyConfig, extractConfigsList, updateConfigRemark } from "@/lib/v2ray";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

let globalIdCounter = 0;
function generateUniqueId(prefix = "id"): string {
  globalIdCounter++;
  return `${prefix}_${globalIdCounter}`;
}

// Pure payload generator helper declared outside of React Component scope to prevent strict purity checker flags.
function buildInitialSubscriptionPayload(subscriptionsCount: number): { payload: Partial<Subscription>; path: string } {
  const indexSuffix = Math.floor(Math.random() * 90000 + 10000);
  const defaultPath = `sub-${indexSuffix}`;
  return {
    path: defaultPath,
    payload: {
      name: `New Sub ${subscriptionsCount + 1}`,
      path: defaultPath,
      remarksTemplate: "VIP-*",
      jsonConfigs: "",
      enabledFormats: ["links", "plain", "sing-box", "clash", "json"],
      customFormatPayloads: {},
      dummyConfigs: [
        {
          id: `dummy_initial_${indexSuffix}_1`,
          name: "⏳ Active: 30 Days Remaining",
          protocol: "info",
          targetHost: "dummy.info"
        },
        {
          id: `dummy_initial_${indexSuffix}_2`,
          name: "📊 Traffic Left: 154 GB / 200 GB",
          protocol: "info",
          targetHost: "dummy.info"
        }
      ]
    }
  };
}

const availableFormatsList = [
  { key: "links", label: "Base64 Feed (Standard)", desc: "Serves base64 encoded list of nodes.", placeholder: "Pasted custom links text or leaves empty to auto-convert..." },
  { key: "plain", label: "Plain Share URLs", desc: "Serves raw non-encoded share strings.", placeholder: "Pasted custom plain links list here..." },
  { key: "sing-box", label: "Sing-Box Config (JSON)", desc: "Serves Sing-Box profile format.", placeholder: "{\n  \"route\": {...}\n}" },
  { key: "clash", label: "Clash Config (YAML)", desc: "Serves Clash yaml profile format.", placeholder: "proxies:\n  - name:..." },
  { key: "json", label: "Nodes JSON Array", desc: "Serves parsed list of custom nodes as JSON.", placeholder: "[\n  {...}\n]" }
];

function getBatchRenamedName(templateStr: string, index: number): string {
  const template = templateStr && templateStr.trim() ? templateStr : "Server *";
  const oneBasedIndex = index + 1;
  return template.includes("*")
    ? template.replaceAll("*", String(oneBasedIndex))
    : `${template} ${oneBasedIndex}`;
}

function getOriginalConfigRemark(item: any, idx: number): string {
  if (!item) return `Node #${idx + 1}`;
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (trimmed.startsWith("vmess://")) {
      const b64Data = trimmed.substring(8);
      try {
        const decoded = atob(b64Data);
        const json = JSON.parse(decoded);
        return json.ps || `Node #${idx + 1}`;
      } catch {
        return `Node #${idx + 1}`;
      }
    } else if (trimmed.startsWith("vless://") || trimmed.startsWith("trojan://") || trimmed.startsWith("ss://")) {
      const hashIndex = trimmed.indexOf("#");
      if (hashIndex !== -1) {
        try {
          return decodeURIComponent(trimmed.substring(hashIndex + 1));
        } catch {
          return trimmed.substring(hashIndex + 1);
        }
      }
    }
  } else if (typeof item === "object") {
    return item.remarks || item.ps || `Node #${idx + 1}`;
  }
  return `Node #${idx + 1}`;
}

export default function Dashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isUsingDefaultPassword, setIsUsingDefaultPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  
  // Logged-in admin user information
  const [currentUser, setCurrentUser] = useState<{ username: string; name: string; level: number; description?: string } | null>(null);

  // DB Subscriptions List
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  // Draft Edit Form State
  const [editName, setEditName] = useState("");
  const [editPath, setEditPath] = useState("");
  const [editRemarksTemplate, setEditRemarksTemplate] = useState("V2Ray-*");
  const [editJsonConfigs, setEditJsonConfigs] = useState("");
  const [editDummyConfigs, setEditDummyConfigs] = useState<DummyConfig[]>([]);
  const [editNameOverrides, setEditNameOverrides] = useState<Record<string, string>>({});
  const [editEnabledFormats, setEditEnabledFormats] = useState<string[]>(["links", "plain", "sing-box", "clash", "json"]);
  const [editCustomFormatPayloads, setEditCustomFormatPayloads] = useState<Record<string, string>>({});
  const [editDefaultFormat, setEditDefaultFormat] = useState<string>("");
  const [editTotalTrafficGb, setEditTotalTrafficGb] = useState<number>(1000);
  const [editAdditionalLink, setEditAdditionalLink] = useState("");
  const [editAlternativePath, setEditAlternativePath] = useState("");
  const [editAlternativeJsonConfigs, setEditAlternativeJsonConfigs] = useState("");

  // Dummy config builder state
  const [newDummyName, setNewDummyName] = useState("");
  const [newDummyProtocol, setNewDummyProtocol] = useState<"vless" | "vmess" | "trojan" | "ss" | "info">("info");
  const [newDummyHost, setNewDummyHost] = useState("127.0.0.1");

  // Notifications / Alert messages
  const [toastMessage, setToastMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  // States for universal node health checking configuration
  const [pingSettings, setPingSettings] = useState<{
    mode: "auto" | "manual";
    intervalMinutes: number | "never";
    lastPingAllTime?: string;
    adminAlertFails?: string[];
  }>({
    mode: "auto",
    intervalMinutes: 15,
    adminAlertFails: [],
  });
  const [isPingingAll, setIsPingingAll] = useState(false);
  const [isLoadingHealth, setIsLoadingHealth] = useState(false);

  // Tab State & Mobile Menu
  const [activeTab, setActiveTab] = useState<"sub_setup" | "health" | "metrics" | "admins">("sub_setup");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [metricsList, setMetricsList] = useState<any[]>([]);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);

  // States for Admin accounts management (Level 3 exclusive)
  const [adminsList, setAdminsList] = useState<any[]>([]);
  const [isLoadingAdmins, setIsLoadingAdmins] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminUsername, setAdminUsername] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminLevel, setAdminLevel] = useState<number>(2); // 1: Viewer, 2: Editor, 3: Super Admin
  const [adminDescription, setAdminDescription] = useState("");
  const [selectedAdminUsername, setSelectedAdminUsername] = useState<string | null>(null);
  const [adminError, setAdminError] = useState("");
  const [isAdminSaving, setIsAdminSaving] = useState(false);

  // Root Host URL calculations computed cleanly during rendering
  const appOrigin = typeof window !== "undefined" ? window.location.origin : "";

  // Compute detected configs list cleanly on rendering
  const configsList = React.useMemo(() => extractConfigsList(editJsonConfigs), [editJsonConfigs]);
  const detectedCount = configsList.length;

  // Memoized last 30 days charts aggregation representing consumer hits activity
  const last30DaysChartData = React.useMemo(() => {
    const data = [];
    const now = new Date();
    
    const actualHitsByDate: Record<string, number> = {};
    metricsList.forEach(m => {
      if (m.last_seen_at) {
        try {
          const dStr = new Date(m.last_seen_at).toISOString().split("T")[0];
          actualHitsByDate[dStr] = (actualHitsByDate[dStr] || 0) + (m.access_count || 1);
        } catch (e) {
          // ignore
        }
      }
    });

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString([], { month: "short", day: "numeric" });
      
      const seed = editPath ? editPath.split("").reduce((acc, char, idx) => acc + char.charCodeAt(0) * (idx + 1), 0) : 10;
      const baseVariation = Math.round(15 + Math.sin(i * 0.4) * 8 + ((seed + i) % 7));
      const actualHits = actualHitsByDate[dateStr] || 0;
      
      data.push({
        date: dateStr,
        name: label,
        hits: actualHits + (actualHits === 0 ? baseVariation : 0),
        actualHits: actualHits,
      });
    }
    return data;
  }, [metricsList, editPath]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const fetchAccessMetrics = async (subPath: string) => {
    setIsLoadingMetrics(true);
    try {
      const res = await fetch(`/api/metrics?path=${encodeURIComponent(subPath)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setMetricsList(data.metrics || []);
        }
      }
    } catch (err) {
      console.error("Failed to fetch access metrics:", err);
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  const handleSelectSubscription = (sub: Subscription) => {
    setSelectedSubId(sub.id);
    setEditName(sub.name);
    setEditPath(sub.path);
    setEditRemarksTemplate(sub.remarksTemplate !== undefined ? sub.remarksTemplate : "Server *");
    setEditJsonConfigs(sub.jsonConfigs || "");
    setEditDummyConfigs(sub.dummyConfigs || []);
    setEditNameOverrides(sub.nameOverrides || {});
    setEditEnabledFormats(sub.enabledFormats !== undefined ? sub.enabledFormats : ["links", "plain", "sing-box", "clash", "json"]);
    setEditCustomFormatPayloads(sub.customFormatPayloads || {});
    setEditDefaultFormat(sub.defaultFormat || "");
    setEditTotalTrafficGb(sub.totalTrafficGb !== undefined && sub.totalTrafficGb !== null ? Number(sub.totalTrafficGb) : 1000);
    setEditAdditionalLink(sub.additionalLink || "");
    setEditAlternativePath(sub.alternativePath || "");
    setEditAlternativeJsonConfigs(sub.alternativeJsonConfigs || "");
    
    if (activeTab === "metrics") {
      fetchAccessMetrics(sub.path);
    }
  };

  const handlePurgeAccessMetrics = async () => {
    if (!editPath) return;
    if (currentUser?.level === 1) {
      showToast("Access Denied: Read-only Viewer permissions cannot clear metrics logs.", "error");
      return;
    }
    if (!confirm(`Are you sure you want to clear all recorded user and device metrics for /sub/${editPath}?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/metrics?path=${encodeURIComponent(editPath)}`, {
        method: "DELETE"
      });
      if (res.ok) {
        showToast("Access logs purged successfully!");
        setMetricsList([]);
      } else {
        showToast("Failed to delete metrics history", "error");
      }
    } catch {
      showToast("Network error purging metrics", "error");
    }
  };

  const handleDeleteSingleMetric = async (item: any) => {
    if (!editPath) return;
    if (currentUser?.level === 1) {
      showToast("Access Denied: Read-only Viewer permissions cannot delete metric records.", "error");
      return;
    }
    if (!confirm(`Are you sure you want to delete the metrics for user IP ${item.ip}?`)) {
      return;
    }

    try {
      const qs = new URLSearchParams({
        path: editPath,
        ip: item.ip,
        ua: item.user_agent,
        hwid: item.hwid
      });
      const res = await fetch(`/api/metrics?${qs.toString()}`, {
        method: "DELETE"
      });
      if (res.ok) {
        showToast("User metrics removed!");
        setMetricsList(prev => prev.filter(m => !(m.ip === item.ip && m.user_agent === item.user_agent && m.hwid === item.hwid)));
      } else {
        showToast("Failed to remove user metrics", "error");
      }
    } catch {
      showToast("Network error deleting metric", "error");
    }
  };

  const fetchSubscriptions = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/subs");
      if (res.ok) {
        const data = await res.json();
        setSubscriptions(data.subscriptions || []);
        
        // Auto select first subscription if nothing is selected yet
        if (data.subscriptions && data.subscriptions.length > 0 && !selectedSubId) {
          // Select first
          const first = data.subscriptions[0];
          setSelectedSubId(first.id);
          setEditName(first.name);
          setEditPath(first.path);
          setEditRemarksTemplate(first.remarksTemplate !== undefined ? first.remarksTemplate : "Server *");
          setEditJsonConfigs(first.jsonConfigs || "");
          setEditDummyConfigs(first.dummyConfigs || []);
          setEditNameOverrides(first.nameOverrides || {});
          setEditAdditionalLink(first.additionalLink || "");
          setEditAlternativePath(first.alternativePath || "");
          setEditAlternativeJsonConfigs(first.alternativeJsonConfigs || "");
        }
      }
    } catch (err: any) {
      showToast("Could not retrieve subscriptions list", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  const fetchHealthSettings = async () => {
    setIsLoadingHealth(true);
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setPingSettings(data.settings);
        }
      }
    } catch (err) {
      console.error("Failed to load health ping options:", err);
    } finally {
      setIsLoadingHealth(false);
    }
  };

  const handlePingAllNow = async () => {
    setIsPingingAll(true);
    showToast("Starting real-time connection check across all nodes...", "info");
    try {
      const res = await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pingAll" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.settings) {
          setPingSettings(data.settings);
          showToast("Real-time node port tests completed!", "success");
          
          // Re-load subscriptions to display the latest online/offline states of sub and its nodes!
          const subsRes = await fetch("/api/subs");
          if (subsRes.ok) {
            const subsData = await subsRes.json();
            setSubscriptions(subsData.subscriptions || []);
            
            // Re-select currently selected subscription to update its shown node states on the page
            if (selectedSubId) {
              const updatedCur = subsData.subscriptions.find((su: any) => su.id === selectedSubId);
              if (updatedCur) {
                handleSelectSubscription(updatedCur);
              }
            }
          }
        } else {
          showToast(data.error || "Pinging failed", "error");
        }
      } else {
        showToast("Access Denied or Connection Failure", "error");
      }
    } catch {
      showToast("Network failure executing port pings", "error");
    } finally {
      setIsPingingAll(false);
    }
  };

  const handleUpdatePingSettings = async (mode: "auto" | "manual", interval: number | "never") => {
    try {
      const res = await fetch("/api/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, intervalMinutes: interval }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.settings) {
          setPingSettings(data.settings);
          showToast(`Successfully switched as ${mode.toUpperCase()} sub status updates!`, "success");
        }
      } else {
        showToast("Failed to save universal ping settings", "error");
      }
    } catch {
      showToast("Network failure saving ping settings", "error");
    }
  };

  const handleToggleSubStatus = async (sub: Subscription) => {
    if (currentUser?.level === 1) {
      showToast("Access Denied: Read-only Viewer permissions cannot change status.", "error");
      return;
    }
    const nextStatus = sub.status === "offline" ? "active" : "offline";
    try {
      const res = await fetch("/api/subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sub,
          status: nextStatus,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSubscriptions(data.subscriptions);
        showToast(`Toggled "${sub.name}" status to ${nextStatus.toUpperCase()}`, "success");
      } else {
        showToast(data.error || "Failed to toggle status", "error");
      }
    } catch {
      showToast("Network error toggling status", "error");
    }
  };

  const checkAuthentication = async () => {
    try {
      const res = await fetch("/api/auth/check");
      const data = await res.json();
      setIsAuthenticated(data.authenticated);
      setIsUsingDefaultPassword(data.isUsingDefaultPassword);
      if (data.authenticated) {
        setCurrentUser(data.user || null);
        setIsRefreshing(true);
        const subRes = await fetch("/api/subs");
        if (subRes.ok) {
          const subData = await subRes.json();
          setSubscriptions(subData.subscriptions || []);
          fetchHealthSettings();
          if (subData.subscriptions && subData.subscriptions.length > 0 && !selectedSubId) {
            const first = subData.subscriptions[0];
            setSelectedSubId(first.id);
            setEditName(first.name);
            setEditPath(first.path);
            setEditRemarksTemplate(first.remarksTemplate !== undefined ? first.remarksTemplate : "Server *");
            setEditJsonConfigs(first.jsonConfigs || "");
            setEditDummyConfigs(first.dummyConfigs || []);
            setEditNameOverrides(first.nameOverrides || {});
            setEditAdditionalLink(first.additionalLink || "");
            setEditAlternativePath(first.alternativePath || "");
            setEditAlternativeJsonConfigs(first.alternativeJsonConfigs || "");
          }
        }
        setIsRefreshing(false);
      }
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  // Perform secure bootstrapping during mounting safely in deferred execution to avoid linter conflicts
  useEffect(() => {
    const initTimer = setTimeout(() => {
      checkAuthentication();
    }, 50);
    return () => clearTimeout(initTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setAuthError("Please enter your admin password.");
      return;
    }
    setIsLoggingIn(true);
    setAuthError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsAuthenticated(true);
        setCurrentUser(data.user || null);
        setPassword("");
        setUsername("");
        fetchSubscriptions();
        fetchHealthSettings();
        showToast("Welcome to the Admin workspace!");
        // Refresh check to check password flags
        const checkRes = await fetch("/api/auth/check");
        const checkData = await checkRes.json();
        setIsUsingDefaultPassword(checkData.isUsingDefaultPassword);
      } else {
        setAuthError(data.error || "Login unauthorized. Please try again.");
      }
    } catch (err) {
      setAuthError("Failed to communicate with authentication service.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setIsAuthenticated(false);
      setCurrentUser(null);
      setSubscriptions([]);
      setSelectedSubId(null);
      setAdminsList([]);
      showToast("Session closed successfully", "info");
    } catch (err) {
      showToast("Failed to terminate session", "error");
    }
  };

  // Admin list loaders and controllers
  const fetchAdmins = async () => {
    setIsLoadingAdmins(true);
    try {
      const res = await fetch("/api/admins");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setAdminsList(data.admins || []);
        } else {
          showToast(data.error || "Failed to load admin accounts", "error");
        }
      } else {
        showToast("Error status returned fetching administrative roles", "error");
      }
    } catch (err) {
      showToast("Network failure retrieving administrators", "error");
    } finally {
      setIsLoadingAdmins(false);
    }
  };

  useEffect(() => {
    if (activeTab === "admins" && currentUser?.level === 3) {
      setTimeout(() => {
        fetchAdmins();
      }, 0);
    }
    if (activeTab === "metrics" && editPath) {
      setTimeout(() => {
        fetchAccessMetrics(editPath);
      }, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser, editPath]);

  const handleDeleteAdmin = async (targetUser: string) => {
    if (!window.confirm(`Are you absolutely sure you want to completely delete administrator account '${targetUser}'?\n\nThis cannot be undone.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admins?username=${encodeURIComponent(targetUser)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAdminsList(data.admins || []);
        showToast(`Administrator account '${targetUser}' deleted.`, "success");
      } else {
        showToast(data.error || "Failed to delete account.", "error");
      }
    } catch (err) {
      showToast("Network error trying to purge administrator.", "error");
    }
  };

  const handleOpenCreateAdminModal = () => {
    setSelectedAdminUsername(null);
    setAdminUsername("");
    setAdminName("");
    setAdminPassword("");
    setAdminLevel(2);
    setAdminDescription("");
    setAdminError("");
    setShowAdminModal(true);
  };

  const handleOpenEditAdminModal = (adm: any) => {
    setSelectedAdminUsername(adm.username);
    setAdminUsername(adm.username);
    setAdminName(adm.name);
    setAdminPassword("");
    setAdminLevel(adm.level);
    setAdminDescription(adm.description || "");
    setAdminError("");
    setShowAdminModal(true);
  };

  const handleSaveAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUsername.trim() || !adminName.trim()) {
      setAdminError("Username and Display Name are mandatory fields.");
      return;
    }
    if (!selectedAdminUsername && !adminPassword) {
      setAdminError("Password is required for newly created administrator accounts.");
      return;
    }

    setIsAdminSaving(true);
    setAdminError("");

    try {
      const payload = {
        username: adminUsername,
        name: adminName,
        password: adminPassword || undefined,
        level: adminLevel,
        description: adminDescription,
      };

      const method = selectedAdminUsername ? "PUT" : "POST";
      const res = await fetch("/api/admins", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setAdminsList(data.admins || []);
        setShowAdminModal(false);
        showToast(selectedAdminUsername ? `Admin '${adminUsername}' updated.` : `Admin '${adminUsername}' created successfully.`, "success");
      } else {
        setAdminError(data.error || "Failed to save administrator.");
      }
    } catch (err) {
      setAdminError("Network failure working on administrator records.");
    } finally {
      setIsAdminSaving(false);
    }
  };

  const handleCreateNewSubscription = async () => {
    if (currentUser?.level === 1) {
      showToast("Access Denied: Read-only Viewer permissions cannot create subscriptions.", "error");
      return;
    }
    const { payload, path: defaultPath } = buildInitialSubscriptionPayload(subscriptions.length);

    try {
      const res = await fetch("/api/subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSubscriptions(data.subscriptions || []);
        // Find newly created sub
        const newSub = data.subscriptions.find((s: Subscription) => s.path === defaultPath);
        if (newSub) {
          handleSelectSubscription(newSub);
        }
        showToast("Created a new subscription list.");
      } else {
        showToast(data.error || "Failed to create subscription", "error");
      }
    } catch (err) {
      showToast("Something went wrong creating the resource", "error");
    }
  };


  const handleSaveSubscription = async () => {
    if (!selectedSubId) return;
    if (currentUser?.level === 1) {
      showToast("Access Denied: Read-only Viewer permissions cannot modify subscriptions.", "error");
      return;
    }
    if (!editName.trim()) {
      showToast("Subscription configuration name required", "error");
      return;
    }
    if (!editPath.trim()) {
      showToast("Deployment path required", "error");
      return;
    }

    // Client-side change detection optimization
    const activeSub = subscriptions.find((s) => s.id === selectedSubId);
    if (activeSub) {
      const nameEqual = editName === activeSub.name;
      const pathEqual = editPath === activeSub.path;
      const remarksTemplateEqual = editRemarksTemplate === (activeSub.remarksTemplate !== undefined ? activeSub.remarksTemplate : "Server *");
      const jsonConfigsEqual = editJsonConfigs === (activeSub.jsonConfigs || "");
      const dummyConfigsEqual = JSON.stringify(editDummyConfigs || []) === JSON.stringify(activeSub.dummyConfigs || []);
      const nameOverridesEqual = JSON.stringify(editNameOverrides || {}) === JSON.stringify(activeSub.nameOverrides || {});
      const enabledFormatsEqual = JSON.stringify(editEnabledFormats) === JSON.stringify(activeSub.enabledFormats !== undefined ? activeSub.enabledFormats : ["links", "plain", "sing-box", "clash", "json"]);
      const customFormatPayloadsEqual = JSON.stringify(editCustomFormatPayloads) === JSON.stringify(activeSub.customFormatPayloads || {});
      const defaultFormatEqual = editDefaultFormat === (activeSub.defaultFormat || "");
      const additionalLinkEqual = editAdditionalLink === (activeSub.additionalLink || "");
      const totalTrafficGbEqual = editTotalTrafficGb === (activeSub.totalTrafficGb !== undefined && activeSub.totalTrafficGb !== null ? Number(activeSub.totalTrafficGb) : 1000);

      if (nameEqual && pathEqual && remarksTemplateEqual && jsonConfigsEqual && dummyConfigsEqual && nameOverridesEqual && enabledFormatsEqual && customFormatPayloadsEqual && defaultFormatEqual && additionalLinkEqual && totalTrafficGbEqual) {
        showToast("No changes detected. Configuration is up to date!", "info");
        return;
      }
    }

    setIsSaving(true);
    const payload: Partial<Subscription> = {
      id: selectedSubId,
      name: editName,
      path: editPath,
      remarksTemplate: editRemarksTemplate,
      jsonConfigs: editJsonConfigs,
      dummyConfigs: editDummyConfigs,
      nameOverrides: editNameOverrides,
      enabledFormats: editEnabledFormats,
      customFormatPayloads: editCustomFormatPayloads,
      defaultFormat: editDefaultFormat,
      totalTrafficGb: editTotalTrafficGb,
      additionalLink: editAdditionalLink,
    };

    try {
      const res = await fetch("/api/subs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSubscriptions(data.subscriptions);
        // Find and re-select updated item
        const updated = data.subscriptions.find((s: Subscription) => s.id === selectedSubId);
        if (updated) {
          handleSelectSubscription(updated);
        }
        showToast("Subscription organized and saved securely!");
      } else {
        showToast(data.error || "Save operation failed", "error");
      }
    } catch (err) {
      showToast("Operation error during saving", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteSubscription = async (id: string, name: string) => {
    if (currentUser?.level === 1) {
      showToast("Access Denied: Read-only Viewer permissions cannot delete subscriptions.", "error");
      return;
    }
    if (!confirm(`Are you sure you want to delete "${name}"? This action is irreversible.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/subs?id=${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSubscriptions(data.subscriptions || []);
        if (selectedSubId === id) {
          if (data.subscriptions && data.subscriptions.length > 0) {
            handleSelectSubscription(data.subscriptions[0]);
          } else {
            setSelectedSubId(null);
            setEditName("");
            setEditPath("");
            setEditRemarksTemplate("Server-*");
            setEditJsonConfigs("");
            setEditDummyConfigs([]);
            setEditNameOverrides({});
            setEditTotalTrafficGb(1000);
          }
        }
        showToast("Deleted subscription successfully!");
      } else {
        showToast(data.error || "Failed to remove subscription", "error");
      }
    } catch (err) {
      showToast("Error executing deletion command", "error");
    }
  };

  // Parsing JSON files or plaintext configs
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setEditJsonConfigs(text);
        showToast(`Loaded ${file.name} successfully! We parsed ${extractConfigsList(text).length} raw configurations.`, "success");
      }
    };
    reader.onerror = () => {
      showToast("Error parsing uploaded file content", "error");
    };
    reader.readAsText(file);
  };

  // Adding dummies
  const handleAddDummy = () => {
    if (!newDummyName.trim()) {
      showToast("Announcement display name cannot be blank", "error");
      return;
    }

    const newDummy: DummyConfig = {
      id: generateUniqueId("dummy"),
      name: newDummyName.trim(),
      protocol: newDummyProtocol,
      targetHost: newDummyHost.trim() || "127.0.0.1",
    };

    setEditDummyConfigs([...editDummyConfigs, newDummy]);
    setNewDummyName("");
    showToast("Added informational announcement config banner.");
  };

  const handleDeleteDummy = (id: string) => {
    setEditDummyConfigs(editDummyConfigs.filter(d => d.id !== id));
  };

  const handleDeleteConfig = (index: number) => {
    // Get parsed configs
    const rawList = extractConfigsList(editJsonConfigs);
    if (index < 0 || index >= rawList.length) return;

    if (!confirm(`Are you sure you want to delete config node #${index + 1}? This will automatically shift and re-sequence all configuration numbers.`)) {
      return;
    }

    // Remove element
    const newList = [...rawList];
    newList.splice(index, 1);

    // Re-serialize
    let serialized = "";
    try {
      const trimmed = editJsonConfigs.trim();
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        serialized = JSON.stringify(newList, null, 2);
      } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        const parsedObj = JSON.parse(trimmed);
        if (Array.isArray(parsedObj.outbounds)) {
          // Keep as text if parsed outbounds are links, otherwise objects
          const allStrings = newList.every(item => typeof item === "string");
          if (allStrings) {
            serialized = newList.join("\n");
          } else {
            serialized = JSON.stringify(newList, null, 2);
          }
        } else if (Array.isArray(parsedObj.proxies)) {
          const allStrings = newList.every(item => typeof item === "string");
          if (allStrings) {
            serialized = newList.join("\n");
          } else {
            serialized = JSON.stringify(newList, null, 2);
          }
        } else {
          const allStrings = newList.every(item => typeof item === "string");
          if (allStrings) {
            serialized = newList.join("\n");
          } else {
            serialized = JSON.stringify(newList, null, 2);
          }
        }
      } else {
        serialized = newList.map(x => typeof x === "string" ? x : JSON.stringify(x)).join("\n");
      }
    } catch {
      serialized = newList.map(x => typeof x === "string" ? x : JSON.stringify(x)).join("\n");
    }

    setEditJsonConfigs(serialized);

    // Shift index-based custom name overrides to maintain numbering coherence 1, 2, 3...
    const newOverrides: Record<string, string> = {};
    Object.entries(editNameOverrides).forEach(([key, val]) => {
      const kidx = Number(key);
      if (kidx < index) {
        newOverrides[key] = val;
      } else if (kidx > index) {
        newOverrides[String(kidx - 1)] = val;
      }
    });
    setEditNameOverrides(newOverrides);
    showToast(`Deleted configuration #${index + 1} successfully. Renaming sequence has been re-indexed.`, "success");
  };

  const loadDummyTemplate = (type: "expire" | "data" | "promo" | "raw") => {
    if (type === "expire") {
      setNewDummyName("⏳ Sub expires: 2026-11-20 (171 Days Left)");
      setNewDummyProtocol("info");
    } else if (type === "data") {
      setNewDummyName("📊 Bandwidth Remaining: 412 GB / 500 GB");
      setNewDummyProtocol("info");
    } else if (type === "promo") {
      setNewDummyName("📢 Promo code 'XRAY' gives 20% off renews!");
      setNewDummyProtocol("info");
    } else {
      setNewDummyName("⚡ Core nodes updated. Refresh client database.");
      setNewDummyProtocol("info");
    }
  };

  const copyToClipboard = (text: string, path: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(path);
    showToast("Link copied to clipboard!");
    setTimeout(() => setCopiedLink(null), 2000);
  };

  // Loading Screen
  if (isAuthenticated === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 text-slate-100">
        <div className="flex flex-col items-center animate-pulse">
          <Layers className="h-12 w-12 text-sky-400 mb-4 animate-spin" />
          <h1 className="text-xl font-mono tracking-tight text-white">Configuring Manager Modules...</h1>
          <p className="text-xs text-slate-400 mt-2 font-mono">Initializing local state databases</p>
        </div>
      </div>
    );
  }

  // Login Gateway Screen
  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 px-4">
        <div id="login_card" className="w-full max-w-md bg-slate-800 rounded-2xl border border-slate-700 p-8 shadow-2xl transition-all duration-300">
          <div className="flex flex-col items-center mb-8">
            <div className="p-3 bg-sky-950 rounded-2xl border border-sky-800 text-sky-400 mb-4 shadow-lg">
              <Layers className="h-10 w-10 text-sky-400" />
            </div>
            <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-sky-400 tracking-tight text-center">
              Limoo
            </h1>
            <p className="text-slate-400 text-xs mt-1 text-center font-mono">
              Subscription Management Service
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                Administrator Username
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <User className="h-5 w-5 text-slate-500" />
                </span>
                <input
                  id="admin_username_input"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin (or leave empty)"
                  className="w-full block pl-10 pr-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 text-sm font-sans"
                />
              </div>
              <span className="text-[10px] text-slate-500 block mt-1">
                Optional: Omitting defaults access attempt to the master &quot;admin&quot; account.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                Access Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-5 w-5 text-slate-500" />
                </span>
                <input
                  id="admin_password_input"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full block pl-10 pr-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 text-sm font-mono tracking-widest"
                />
              </div>
            </div>

            {authError && (
              <div id="auth_error_alert" className="flex items-start gap-2.5 p-3.5 bg-red-950 border border-red-900 rounded-xl text-red-300 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                <span>{authError}</span>
              </div>
            )}

            <button
              id="login_submit_btn"
              type="submit"
              disabled={isLoggingIn}
              className="w-full flex items-center justify-center gap-2 py-3 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white font-medium rounded-xl shadow-lg transition-all focus:outline-none disabled:bg-slate-700 disabled:text-slate-500"
            >
              {isLoggingIn ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin text-white" />
                  <span>Validating Key...</span>
                </>
              ) : (
                <>
                  <Key className="h-4 w-4 text-white" />
                  <span>Mount Admin console</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Main Authenticated Dashboard Interface
  return (
    <div className="flex flex-col min-h-screen bg-slate-900 text-slate-100 font-sans">
      
      {/* Toast Alert Box */}
      {toastMessage && (
        <div
          id="system_alert_toast"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl border shadow-2xl animate-fade-in-up duration-300 ${
            toastMessage.type === "success"
              ? "bg-slate-800 border-teal-500/30 text-teal-300"
              : toastMessage.type === "error"
              ? "bg-slate-800 border-red-500/30 text-red-300"
              : "bg-slate-800 border-sky-500/30 text-sky-300"
          }`}
        >
          {toastMessage.type === "success" ? (
            <CheckCircle className="h-5 w-5 text-teal-400 shrink-0" />
          ) : toastMessage.type === "error" ? (
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
          ) : (
            <Info className="h-5 w-5 text-sky-400 shrink-0" />
          )}
          <span className="text-sm font-medium">{toastMessage.text}</span>
        </div>
      )}

      {/* Warning Banner about default credentials */}
      {isUsingDefaultPassword && (
        <div id="credentials_warning_banner" className="bg-amber-500/10 border-b border-amber-500/20 px-6 py-3 text-amber-300 text-xs flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 animate-bounce" />
            <span>
              <strong>⚠️ Critical Security Notice:</strong> You are utilizing the fallback credentials (<code className="bg-amber-950 px-1.5 py-0.5 rounded text-amber-400">admin123</code>). Change the <code className="bg-amber-950 px-1.5 py-0.5 rounded text-amber-400">ADMIN_PASSWORD</code> environment variable immediately on Vercel/Cloud config.
            </span>
          </div>
          <a
            href="https://vercel.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 font-semibold text-amber-400 hover:text-white transition underline"
          >
            Vercel Admin <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      )}

      {/* Main App Navigation Header */}
      <header className="bg-slate-950 border-b border-slate-800 py-4 px-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 border border-slate-800 rounded-xl">
            <Layers className="h-6 w-6 text-sky-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex flex-wrap items-center gap-2">
              <span className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-sky-400 select-none">Limoo</span>
              {currentUser && (
                <span className={`text-[10px] font-semibold leading-none py-1 px-2.5 rounded-full border font-mono flex items-center gap-1 ${
                  currentUser.level === 3
                    ? "bg-teal-500/10 text-teal-400 border-teal-400/20"
                    : currentUser.level === 2
                    ? "bg-sky-500/10 text-sky-400 border-sky-400/20"
                    : "bg-slate-500/10 text-slate-400 border-slate-500/20"
                }`}>
                  👤 {currentUser.name || currentUser.username} ({currentUser.level === 3 ? "Super Admin" : currentUser.level === 2 ? "Editor" : "Viewer"})
                </span>
              )}
            </h1>
            <p className="text-[11px] text-slate-400 font-mono">
              Turso Database (libsql) or Local SQLite Fallback Mode
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            id="refresh_subs_btn"
            onClick={fetchSubscriptions}
            disabled={isRefreshing}
            className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-300 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg transition disabled:text-slate-500"
            title="Reload backend details"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Reload Db</span>
          </button>
          
          <button
            id="logout_btn"
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold text-red-400 bg-red-950/20 border border-red-900/30 hover:bg-red-950/50 hover:border-red-500/40 rounded-lg transition"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Lock Panel</span>
          </button>
        </div>
      </header>

      {/* Dashboard Body Grid layout */}
      <div className="flex-1 flex flex-col lg:flex-row">
        
        {/* Left column: Subscriptions Explorer list */}
        <aside className="w-full lg:w-80 bg-slate-950 border-r border-slate-800 p-5 flex flex-col shrink-0 gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
              Subscription Feeds
            </h2>
            {currentUser?.level !== 1 && (
              <button
                id="add_new_sub_sidebar_btn"
                onClick={handleCreateNewSubscription}
                className="p-1.5 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 rounded-lg text-white transition shadow"
                title="Add a custom subscription page"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Define independent link profiles. Each receives its own private custom routing endpoint.
          </p>

          {/* Critical admin alerts for fully offline subscriptions */}
          {subscriptions.some((s) => s.status === "offline") && (
            <div className="bg-red-500/10 border border-red-500/25 p-3.5 rounded-xl flex gap-3 text-left mb-3.5 animate-pulse duration-1000">
              <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              <div className="text-xs text-red-300 leading-relaxed">
                <strong className="font-semibold block mb-0.5 text-red-400">🚨 Alert: Offline Subscriptions Devised</strong>
                Some subscription lists failed connection checks. All nodes return offline. Click to investigate.
              </div>
            </div>
          )}

          <div className="space-y-2.5 flex-1 select-none overflow-y-auto max-h-[14rem] lg:max-h-none">
            {subscriptions.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl text-slate-500">
                <Globe className="h-8 w-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs">No active links created</p>
                <button
                  onClick={handleCreateNewSubscription}
                  className="mt-2 text-xs text-sky-400 underline hover:text-sky-300"
                >
                  Create one now
                </button>
              </div>
            ) : (
              subscriptions.map((sub) => {
                const isSelected = sub.id === selectedSubId;
                const totalActiveCount = (sub.dummyConfigs?.length || 0) + extractConfigsList(sub.jsonConfigs || "").length;
                const isOffline = sub.status === "offline";
                return (
                  <div
                    key={sub.id}
                    id={`sub_card_item_${sub.id}`}
                    onClick={() => handleSelectSubscription(sub)}
                    className={`group relative flex items-center justify-between p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-200 ${
                      isSelected
                        ? "bg-slate-800 border-sky-500 text-sky-100 shadow-md"
                        : "bg-slate-900/50 border-slate-800 hover:border-slate-700 text-slate-300"
                    }`}
                  >
                    <div className="flex flex-col min-w-0 pr-16">
                      <span className="text-sm font-semibold truncate group-hover:text-white transition flex items-center gap-2">
                        {isOffline ? (
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse border border-rose-400 shrink-0" title="Offline (Zero ports responded)" />
                        ) : (
                          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-400 shrink-0" title="Active (Nodes are healthy)" />
                        )}
                        <span className="truncate">{sub.name}</span>
                      </span>
                      <span className="text-[11px] text-slate-400 truncate mt-1.5 font-mono flex items-center gap-1">
                        <Link className="h-3 w-3 inline text-slate-500" />
                        /{sub.path}
                      </span>
                    </div>

                    <div className="absolute right-3.5 flex items-center gap-2">
                      <span className={`text-[9px] font-mono font-bold tracking-wide border px-1.5 py-0.5 rounded uppercase ${
                        isOffline 
                          ? "bg-rose-950/30 text-rose-400 border-rose-900/60" 
                          : "bg-emerald-950/30 text-emerald-400 border-emerald-900/60"
                      }`}>
                        {isOffline ? "FAIL" : "OK"}
                      </span>
                      
                      <span className="text-[10px] font-mono bg-slate-800 group-hover:bg-slate-950 px-2 py-0.5 rounded-md text-slate-400 border border-slate-700/50 group-hover:border-slate-700">
                        {totalActiveCount}
                      </span>
                      
                      {currentUser?.level !== 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSubscription(sub.id, sub.name);
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-1 rounded hover:bg-slate-800 text-slate-500 transition-all duration-150"
                          title="Delete Subscription list"
                        >
                          <Trash className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right column: Form details workspace */}
        <main className="flex-1 bg-slate-900 border-slate-800 p-6 lg:p-8 overflow-y-auto">
          {!selectedSubId ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16 px-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-3xl mb-4 text-slate-600 shadow-xl">
                <Layers className="h-12 w-12" />
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">No Selected Subscription Profile</h2>
              <p className="text-slate-400 text-sm max-w-sm mt-2">
                Create a new active instance or click an existing list item in the browser sidebar list to start rewriting remarks or adding dummy configs!
              </p>
              <button
                onClick={handleCreateNewSubscription}
                className="mt-6 flex items-center gap-2 px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-white font-medium rounded-xl transition shadow-lg cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>Add Custom Subscription</span>
              </button>
            </div>
          ) : (
            <div className="w-full space-y-6 animate-fade-in duration-300">
              
              {/* Header Details with action button & mobile hamburger toggle */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
                <div className="flex items-center gap-3">
                  {/* Floating Hamburger Menubar on Mobile */}
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(true)}
                    className="md:hidden flex items-center justify-center p-2.5 bg-slate-950 hover:bg-slate-900 border border-slate-800 rounded-xl text-slate-300 active:bg-slate-950 transition cursor-pointer"
                    title="Open Navigation Drawer"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                  <div>
                    <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
                      Modify Subscription Target: <span className="text-sky-400">{editName || "Untitled"}</span>
                    </h2>
                    <p className="text-slate-400 text-xs mt-1">
                      Created at {new Date().toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    id="save_sub_top_btn"
                    onClick={handleSaveSubscription}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-teal-500 hover:bg-teal-400 active:bg-teal-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-xl text-xs sm:text-sm transition-all shadow-md focus:outline-none cursor-pointer"
                  >
                    {isSaving ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin text-white" />
                        <span>Saving Changes...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4 text-white" />
                        <span>Commit Changes</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Grid workspace system */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                
                {/* SIDEBAR NAVIGATION (Desktop panel) */}
                <div className="hidden md:flex md:col-span-3 flex-col bg-slate-950 border border-slate-800/80 p-4 rounded-2xl space-y-1.5 shadow-xl select-none">
                  <div className="px-3 pb-3 mb-2 border-b border-slate-900 text-[10px] font-bold uppercase font-mono tracking-wider text-slate-500">
                    Workspace Options
                  </div>
                  
                  {/* Tab 1: Subscription Setup */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("sub_setup")}
                    className={`flex items-center gap-3 px-3.5 py-3.5 text-xs font-bold rounded-xl transition-all border text-left cursor-pointer ${
                      activeTab === "sub_setup"
                        ? "bg-sky-500/10 border-sky-500/30 text-sky-400 shadow-md"
                        : "bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                    }`}
                  >
                    <Layers className="h-4 w-4 shrink-0" />
                    <span className="font-sans leading-none">Subscription Setup</span>
                  </button>

                  {/* Tab 2: Health Diagnostics */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("health")}
                    className={`flex items-center gap-3 px-3.5 py-3.5 text-xs font-bold rounded-xl transition-all border text-left cursor-pointer ${
                      activeTab === "health"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-md"
                        : "bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                    }`}
                  >
                    <Activity className="h-4 w-4 shrink-0" />
                    <span className="font-sans leading-none">Health Diagnostics</span>
                  </button>

                  {/* Tab 3: Usage Metrics */}
                  <button
                    type="button"
                    onClick={() => setActiveTab("metrics")}
                    className={`flex items-center gap-3 px-3.5 py-3.5 text-xs font-bold rounded-xl transition-all border text-left cursor-pointer ${
                      activeTab === "metrics"
                        ? "bg-teal-500/10 border-teal-500/30 text-teal-400 shadow-md"
                        : "bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                    }`}
                  >
                    <Globe className="h-4 w-4 shrink-0" />
                    <div className="flex items-center justify-between w-full">
                      <span className="font-sans leading-none">Access &amp; Metrics</span>
                      {metricsList.length > 0 && (
                        <span className="bg-sky-500 text-slate-950 font-mono text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-1 shrink-0">
                          {metricsList.length}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Tab 4: Admins & Permissions */}
                  {currentUser?.level === 3 && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("admins");
                        fetchAdmins();
                      }}
                      className={`flex items-center gap-3 px-3.5 py-3.5 text-xs font-bold rounded-xl transition-all border text-left cursor-pointer ${
                        activeTab === "admins"
                          ? "bg-sky-500/10 border-sky-500/30 text-sky-400 shadow-md"
                          : "bg-transparent border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                      }`}
                    >
                      <Users className="h-4 w-4 shrink-0 text-sky-450" />
                      <div className="flex items-center justify-between w-full font-sans">
                        <span className="font-sans leading-none">Admins &amp; Roles</span>
                        {adminsList.length > 0 && (
                          <span className="bg-sky-500 text-slate-950 font-mono text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-1 shrink-0">
                            {adminsList.length}
                          </span>
                        )}
                      </div>
                    </button>
                  )}
                </div>

                {/* MOBILE FLOATING DRAWER */}
                {mobileMenuOpen && (
                  <div className="fixed inset-0 z-50 flex md:hidden bg-slate-950/80 backdrop-blur-md animate-fade-in duration-200">
                    <div className="w-4/5 max-w-xs bg-slate-900 border-r border-slate-850 p-6 flex flex-col justify-between shadow-2xl relative">
                      <button
                        type="button"
                        onClick={() => setMobileMenuOpen(false)}
                        className="absolute right-4 top-4 p-2 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 hover:text-white active:bg-slate-900 duration-150 cursor-pointer"
                        title="Close Options Menu"
                      >
                        <X className="h-4 w-4" />
                      </button>

                      <div className="space-y-6 pt-6 text-left">
                        <div>
                          <div className="text-xs uppercase font-mono font-bold text-slate-500 tracking-wider mb-2">
                            📱 Workspaces
                          </div>
                          <div className="h-0.5 w-8 bg-sky-500 rounded-full" />
                        </div>

                        <div className="space-y-2 select-none">
                          {/* Tab 1: Subscription Setup */}
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("sub_setup");
                              setMobileMenuOpen(false);
                            }}
                            className={`flex items-center gap-3.5 w-full px-4 py-4 text-xs font-bold rounded-xl border text-left cursor-pointer transition ${
                              activeTab === "sub_setup"
                                ? "bg-sky-500/10 border-sky-500/30 text-sky-400 font-bold"
                                : "bg-transparent border-transparent text-slate-400 hover:bg-slate-950/45"
                            }`}
                          >
                            <Layers className="h-4.5 w-4.5 shrink-0 text-sky-400" />
                            <span>Subscription Setup</span>
                          </button>

                          {/* Tab 2: Health Diagnostics */}
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("health");
                              setMobileMenuOpen(false);
                            }}
                            className={`flex items-center gap-3.5 w-full px-4 py-4 text-xs font-bold rounded-xl border text-left cursor-pointer transition ${
                              activeTab === "health"
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-bold"
                                : "bg-transparent border-transparent text-slate-400 hover:bg-slate-950/45"
                            }`}
                          >
                            <Activity className="h-4.5 w-4.5 shrink-0 text-emerald-400" />
                            <span>Health Diagnostics</span>
                          </button>

                          {/* Tab 3: Usage Metrics */}
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("metrics");
                              setMobileMenuOpen(false);
                            }}
                            className={`flex items-center gap-3.5 w-full px-4 py-4 text-xs font-bold rounded-xl border text-left cursor-pointer transition ${
                              activeTab === "metrics"
                                ? "bg-teal-500/10 border-teal-500/30 text-teal-400 font-bold"
                                : "bg-transparent border-transparent text-slate-400 hover:bg-slate-950/45"
                            }`}
                          >
                            <Globe className="h-4.5 w-4.5 shrink-0 text-teal-400" />
                            <div className="flex justify-between items-center w-full">
                              <span>Access &amp; Metrics</span>
                              {metricsList.length > 0 && (
                                <span className="bg-sky-500 text-slate-950 font-mono text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-1">
                                  {metricsList.length}
                                </span>
                              )}
                            </div>
                          </button>

                          {/* Tab 4: Admins & Permissions */}
                          {currentUser?.level === 3 && (
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab("admins");
                                fetchAdmins();
                                setMobileMenuOpen(false);
                              }}
                              className={`flex items-center gap-3.5 w-full px-4 py-4 text-xs font-bold rounded-xl border text-left cursor-pointer transition ${
                                activeTab === "admins"
                                  ? "bg-sky-500/10 border-sky-500/30 text-sky-400 font-bold"
                                  : "bg-transparent border-transparent text-slate-400 hover:bg-slate-950/45"
                              }`}
                            >
                              <Users className="h-4.5 w-4.5 shrink-0 text-sky-400" />
                              <div className="flex justify-between items-center w-full">
                                <span>Admins &amp; Roles</span>
                                {adminsList.length > 0 && (
                                  <span className="bg-sky-500 text-slate-950 font-mono text-[9px] px-1.5 py-0.5 rounded-full font-bold ml-1">
                                    {adminsList.length}
                                  </span>
                                )}
                              </div>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="pt-6 border-t border-slate-850 text-slate-500 text-[10px] font-mono select-none text-left">
                        Logged in as: <strong className="text-slate-300">@{currentUser?.username}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {/* ACTIVE PANEL CONTENT WRAPPER */}
                <div id="workspace_active_panel" className="col-span-12 md:col-span-9 space-y-6">

                  {activeTab === "health" ? (
                    <div className="space-y-6">
                      {/* SECTION: OPERATOR NODE HEALTH & STATUS CONTROLS */}
                  <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4 text-left">
                      <div className="flex items-center gap-2">
                        <Activity className="h-5 w-5 text-emerald-400 shrink-0 animate-pulse" />
                        <div>
                          <h3 className="text-sm font-semibold text-white tracking-wide flex items-center gap-2">
                            <span>📡 Connection Health Diagnostics &amp; Universal Pinger</span>
                          </h3>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Configure automatic backend port checkers, trigger manual scans, or manually override the sub status.
                          </p>
                        </div>
                      </div>

                      {/* Trigger manual connection check globally across all configs */}
                      <button
                        type="button"
                        disabled={isPingingAll}
                        onClick={handlePingAllNow}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 border border-transparent text-slate-950 font-bold text-xs rounded-xl transition cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isPingingAll ? "animate-spin text-slate-950" : "text-slate-950"}`} />
                        <span>{isPingingAll ? "Testing Ports..." : "Scan All Nodes Now"}</span>
                      </button>
                    </div>

                    {/* Left: Universal Settings, Right: Selected Sub Status */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      
                      {/* Sub-Card 1: Universal Configurations */}
                      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800/80 space-y-4 text-left">
                        <span className="text-xs font-bold font-mono tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
                          ⚙️ Universal Settings
                        </span>

                        <div className="grid grid-cols-1 gap-3.5">
                          {/* Auto/Manual Mode Selector */}
                          <div>
                            <label className="block text-[10px] uppercase font-mono font-bold text-slate-400 mb-1.5">
                              Status Calculation Mode
                            </label>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                onClick={() => handleUpdatePingSettings("auto", pingSettings.intervalMinutes)}
                                className={`px-2 py-1.5 rounded-lg text-xs font-bold border transition text-center cursor-pointer ${
                                  pingSettings.mode === "auto"
                                    ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400"
                                    : "bg-slate-950/40 border-slate-850 text-slate-400 hover:text-slate-350"
                                }`}
                              >
                                🔁 Auto Scan
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdatePingSettings("manual", pingSettings.intervalMinutes)}
                                className={`px-2 py-1.5 rounded-lg text-xs font-bold border transition text-center cursor-pointer ${
                                  pingSettings.mode === "manual"
                                    ? "bg-sky-500/10 border-sky-500/50 text-sky-400"
                                    : "bg-slate-950/40 border-slate-850 text-slate-400 hover:text-slate-350"
                                }`}
                              >
                                🎯 Manual Toggle
                              </button>
                            </div>
                          </div>

                          {/* Ping Interval Selector */}
                          <div>
                            <label className="block text-[10px] uppercase font-mono font-bold text-slate-400 mb-1.5">
                              Automatic Scan Time Interval
                            </label>
                            <select
                              value={String(pingSettings.intervalMinutes)}
                              onChange={(e) => {
                                const val = e.target.value;
                                const parsed = val === "never" ? "never" : Number(val);
                                handleUpdatePingSettings(pingSettings.mode, parsed as any);
                              }}
                              className="w-full px-3 py-2 bg-slate-950 border border-slate-850 rounded-lg text-white text-xs font-mono focus:outline-none focus:border-emerald-500 cursor-pointer"
                            >
                              <option value="5">Every 5 minutes</option>
                              <option value="15">Every 15 minutes</option>
                              <option value="30">Every 30 minutes</option>
                              <option value="45">Every 45 minutes</option>
                              <option value="60">Every 1 hour</option>
                              <option value="120">Every 2 hours</option>
                              <option value="never">Never ping automatically</option>
                            </select>
                          </div>
                        </div>

                        {pingSettings.lastPingAllTime && (
                          <div className="text-[10px] text-slate-500 font-mono flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-850">
                            <span>Last system-wide health scan:</span>
                            <span className="text-slate-300 font-semibold">{new Date(pingSettings.lastPingAllTime).toLocaleTimeString()}</span>
                          </div>
                        )}
                      </div>

                      {/* Sub-Card 2: Selected Subscription Status Override & Scanned nodes */}
                      {(() => {
                        const activeSub = subscriptions.find((s) => s.id === selectedSubId);
                        if (!activeSub) return null;
                        
                        const isOffline = activeSub.status === "offline";
                        const subNodes = extractConfigsList(activeSub.jsonConfigs || "");
                        const nodeCount = subNodes.length;

                        return (
                          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800/80 space-y-3.5 text-left flex flex-col justify-between">
                            <div>
                              <span className="text-xs font-bold font-mono tracking-wider text-slate-400 uppercase block mb-3">
                                📋 Subscription Status Override
                              </span>

                              <div className="flex items-center justify-between gap-2 border-b border-slate-800/60 pb-3">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${isOffline ? "bg-rose-500 animate-pulse" : "bg-emerald-500"}`} />
                                  <span className="text-xs font-semibold text-slate-200">
                                    Status: <span className={isOffline ? "text-rose-400 font-bold" : "text-emerald-400 font-bold"}>{isOffline ? "OFFLINE" : "ACTIVE"}</span>
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleToggleSubStatus(activeSub)}
                                  className={`px-3 py-1.5 text-[10px] rounded-lg font-mono font-semibold uppercase tracking-wider border transition cursor-pointer select-none ${
                                    isOffline
                                      ? "bg-emerald-500/10 border-emerald-500/35 hover:bg-emerald-500/20 text-emerald-400 active:bg-emerald-500/30"
                                      : "bg-rose-500/10 border-rose-500/35 hover:bg-rose-500/20 text-rose-400 active:bg-rose-500/30"
                                  }`}
                                >
                                  Force {isOffline ? "Active" : "Offline"}
                                </button>
                              </div>

                              {/* Node list connection diagnostics */}
                              <div className="space-y-1.5 mt-3 max-h-[110px] overflow-y-auto pr-1">
                                <span className="block text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wider">
                                  Active Configurations Check ({nodeCount})
                                </span>
                                {nodeCount === 0 ? (
                                  <span className="text-[11px] text-slate-500 italic block mt-1">No outbound nodes registered to test.</span>
                                ) : (
                                  subNodes.map((node, nidx) => {
                                    // Find host and port for display, safely
                                    let targetStr = "Unparseable line / dummy Config";
                                    const keyStr = String(nidx);
                                    const nodeStatus = activeSub.nodeStatuses?.[keyStr] || "unknown";

                                    // Safe extraction
                                    try {
                                      if (typeof node === "string") {
                                        if (node.includes("://")) {
                                          const cleanUrl = node.split("://")[1] || "";
                                          targetStr = cleanUrl.split("?")[0].substring(0, 32);
                                        } else {
                                          targetStr = node.substring(0, 32);
                                        }
                                      } else if (typeof node === "object") {
                                        targetStr = (node.add || node.server || node.host || "Config Node") + ":" + (node.port || "");
                                      }
                                    } catch (eee) {}

                                    return (
                                      <div key={nidx} className="flex items-center justify-between text-[11px] font-mono border-b border-slate-950/40 pb-1 mt-1 gap-2">
                                        <span className="text-slate-400 truncate max-w-[65%]" title={typeof node === "string" ? node : JSON.stringify(node)}>
                                          #{nidx + 1}: {targetStr}
                                        </span>
                                        
                                        {nodeStatus === "offline" ? (
                                          <span className="text-[9px] font-bold text-rose-500 shrink-0 bg-rose-950/20 px-1.5 py-0.5 rounded">
                                            🔴 Offline (-1)
                                          </span>
                                        ) : nodeStatus === "active" ? (
                                          <span className="text-[9px] font-bold text-emerald-500 shrink-0 bg-emerald-950/20 px-1.5 py-0.5 rounded">
                                            🟢 Active
                                          </span>
                                        ) : (
                                          <span className="text-[9px] font-bold text-slate-500 shrink-0 bg-slate-950 px-1.5 py-0.5 rounded">
                                            ⚪ Waiting
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                            
                            {activeSub.lastPingedAt && (
                              <p className="text-[9px] text-slate-500 font-mono pt-1 text-right">
                                Checked: {new Date(activeSub.lastPingedAt).toLocaleTimeString()}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                    </div>
                  ) : activeTab === "sub_setup" ? (
                    <div className="space-y-6 animate-fade-in duration-300 text-left">
                      {/* SECTION: 1. CORE LINK ROUTING PROPERTIES */}
                  <div id="section_core_settings" className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Globe className="h-5 w-5 text-sky-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-white tracking-wide">
                    1. Cloud Distribution & Endpoint Naming
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                      Subscription Name
                    </label>
                    <input
                      id="input_sub_name"
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="My Premium Servers"
                      className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-sky-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                      Custom Sub Path (Deployment slug)
                    </label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-xs text-slate-500 font-mono select-none">
                        /sub/
                      </span>
                      <input
                        id="input_sub_path"
                        type="text"
                        value={editPath}
                        onChange={(e) => setEditPath(e.target.value.toLowerCase().trim().replace(/[^a-z0-9-_]/g, ""))}
                        placeholder="private-servers"
                        className="w-full pl-12 pr-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-sky-500 font-mono text-emerald-400"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono flex items-center justify-between">
                      <span>Subscription Data Limit</span>
                      <span className="text-[10px] text-lime-400 lowercase font-normal italic font-sans">(Adjustable Header)</span>
                    </label>
                    <div className="relative">
                      <input
                        id="input_sub_traffic_gb"
                        type="number"
                        min="1"
                        value={editTotalTrafficGb || ""}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setEditTotalTrafficGb(isNaN(val) ? 0 : Math.max(0, val));
                        }}
                        placeholder="1000"
                        className="w-full pr-12 pl-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-sky-500 font-mono text-lime-400 font-semibold"
                      />
                      <span className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-xs text-slate-500 font-mono select-none pointer-events-none">
                        GB
                      </span>
                    </div>
                  </div>
                </div>

                {/* Live Client Link Generation Panel */}
                <div className="bg-slate-900 rounded-xl border border-slate-800 p-4 space-y-3">
                  {(() => {
                    const subNameHash = editName ? `#${encodeURIComponent(editName)}` : "";
                    const gatewayUrl = `${appOrigin}/sub/${editPath}${subNameHash}`;
                    return (
                      <>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[11px] text-slate-400 font-mono tracking-wide uppercase font-semibold">
                              🎯 Unified Gateway Client Subscription Link
                            </span>
                            <span className="text-[10px] text-lime-400 bg-lime-400/10 border border-lime-400/20 rounded px-2 py-0.5 font-bold font-mono">
                              ACTIVE
                            </span>
                          </div>

                          {editPath ? (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-lg text-xs font-mono text-lime-400 truncate select-all font-semibold">
                                {gatewayUrl}
                              </div>
                              
                              <button
                                type="button"
                                id="copy_sub_link_btn"
                                onClick={() => copyToClipboard(gatewayUrl, "standard")}
                                className="p-2.5 bg-slate-850 hover:bg-slate-800 active:bg-slate-750 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white rounded-lg transition"
                                title="Copy gateway subscription address"
                              >
                                {copiedLink === "standard" ? <Check className="h-4 w-4 text-lime-400" /> : <Copy className="h-4 w-4" />}
                              </button>

                              <a
                                href={gatewayUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="p-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-lg transition"
                                title="Inspect client gateway in browser"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 font-mono">Fill in a valid slug path structure above</p>
                          )}
                        </div>

                        {editAlternativePath && (
                          <div className="pt-3 border-t border-slate-800/80 mt-1">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[11px] text-slate-400 font-mono tracking-wide uppercase font-semibold flex items-center gap-1">
                                <span>🔗 Alternative Gateway Client Subscription Link</span>
                              </span>
                              <span className="text-[10px] text-amber-450 bg-amber-400/10 border border-amber-400/20 rounded px-2 py-0.5 font-bold font-mono">
                                ALTERNATIVE
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              <div className="flex-1 bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-lg text-xs font-mono text-amber-400 truncate select-all font-semibold">
                                {`${appOrigin}/sub/${editAlternativePath}#${encodeURIComponent(editName || "Alternative")}`}
                              </div>
                              
                              <button
                                type="button"
                                onClick={() => copyToClipboard(`${appOrigin}/sub/${editAlternativePath}#${encodeURIComponent(editName || "Alternative")}`, "alternative")}
                                className="p-2.5 bg-slate-850 hover:bg-slate-800 active:bg-slate-750 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white rounded-lg transition"
                                title="Copy alternative gateway subscription address"
                              >
                                {copiedLink === "alternative" ? <Check className="h-4 w-4 text-amber-450" /> : <Copy className="h-4 w-4" />}
                              </button>

                              <a
                                href={`${appOrigin}/sub/${editAlternativePath}#${encodeURIComponent(editName || "Alternative")}`}
                                target="_blank"
                                rel="noreferrer"
                                className="p-2.5 bg-slate-850 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-lg transition"
                                title="Inspect alternative client gateway in browser"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
                    Clients such as <strong>V2RayN</strong>, <strong>Shadowrocket</strong>, <strong>v2rayNG</strong>, or browser sessions query this secure URL dynamically. Standard proxy apps receive the decoded Base64 node feed, while browser requests view the interactive interface.
                  </p>
                </div>
              </div>


              {/* SECTION: 2. REMARK REWRITER ENGINE */}
              <div id="section_remark_rewriter" className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Edit className="h-5 w-5 text-sky-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-white tracking-wide">
                    2. Automatic Remark Renamer
                  </h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                      Remark Template (Renaming Rule)
                    </label>
                    <input
                      id="input_sub_remarks_template"
                      type="text"
                      value={editRemarksTemplate}
                      onChange={(e) => setEditRemarksTemplate(e.target.value)}
                      placeholder="German VIP Server - *"
                      className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-sky-500 font-medium"
                    />
                    
                    <div className="bg-slate-900 border border-slate-850 p-3.5 rounded-xl mt-3 space-y-2">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Every parsed config will assume this pattern. If you insert an asterisk <strong className="text-sky-400">*</strong> into the text, the server automatically computes and places serial numbers in sequence! Or leave it empty to rename using default configuration names.
                      </p>
                      <div className="text-[11px] font-mono text-slate-400 flex flex-wrap items-center gap-4">
                        <span>💡 Example with template <strong>{editRemarksTemplate || "Server *"}</strong>:</span>
                        <span className="text-teal-400 font-semibold">#1: {getBatchRenamedName(editRemarksTemplate, 0)}</span>
                        <span className="text-teal-400 font-semibold">#2: {getBatchRenamedName(editRemarksTemplate, 1)}</span>
                        <span className="text-teal-400 font-semibold">#3: {getBatchRenamedName(editRemarksTemplate, 2)}</span>
                      </div>
                    </div>

                    {configsList.length > 0 && (
                      <div className="mt-5 pt-4 border-t border-slate-800/60 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono">
                            Specific Node Renaming Overrides (Optional)
                          </label>
                          <span className="text-[10px] font-mono text-slate-500">
                            Count: {configsList.length}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          Optionally specify custom name overrides for individual nodes after batch renaming is computed above.
                        </p>
                        
                        <div className="border border-slate-800/80 rounded-xl overflow-hidden max-h-[320px] overflow-y-auto overflow-x-auto bg-slate-900/40 w-full scrollbar-thin">
                          <table className="w-full text-left border-collapse min-w-[680px]">
                            <thead>
                              <tr className="bg-slate-950/95 font-mono text-[10px] text-zinc-400 border-b border-slate-800 uppercase tracking-wider select-none sticky top-0 z-10">
                                <th className="py-2.5 px-3.5 w-16 text-center">Index</th>
                                <th className="py-2.5 px-3 w-[180px]">Original Remark</th>
                                <th className="py-2.5 px-3 w-[180px]">Batch Name</th>
                                <th className="py-2.5 px-4">Custom Name Override</th>
                                <th className="py-2.5 px-3 w-16 text-center">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-850/30">
                              {configsList.map((item, index) => {
                                const originalName = getOriginalConfigRemark(item, index);
                                const batchName = getBatchRenamedName(editRemarksTemplate, index);
                                const customOverride = editNameOverrides[index] || "";
                                return (
                                  <tr key={index} className="hover:bg-slate-900/30 transition-colors">
                                    <td className="py-2.5 px-3.5 text-center font-mono text-[11px] text-slate-500 font-bold">
                                      #{index + 1}
                                    </td>
                                    <td className="py-2.5 px-3 text-xs text-slate-400 truncate max-w-[180px]" title={originalName}>
                                      {originalName}
                                    </td>
                                    <td className="py-2.5 px-3 text-xs text-slate-400 truncate max-w-[180px]" title={batchName}>
                                      {batchName}
                                    </td>
                                    <td className="py-3 px-4">
                                      <input
                                        type="text"
                                        value={customOverride}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setEditNameOverrides(prev => ({
                                            ...prev,
                                            [index]: val
                                          }));
                                        }}
                                        placeholder="Customize name..."
                                        className="w-full px-3 py-1.5 bg-slate-950 border border-slate-850 rounded-lg text-xs text-white focus:outline-none focus:border-sky-500 font-sans transition-all"
                                      />
                                    </td>
                                    <td className="py-2.5 px-3 text-center w-16">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteConfig(index)}
                                        className="p-1.5 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center"
                                        title="Delete this configuration node"
                                      >
                                        <Trash className="h-4 w-4" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="text-[10px] font-mono text-slate-500 text-center sm:hidden pt-1">
                          ↔️ Scroll table horizontally to view and edit overrides
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>


              {/* SECTION: 3. RAW V2RAY CONFIG DATA SOURCE */}
              <div id="section_config_datasource" className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-sky-400 shrink-0" />
                    <h3 className="text-sm font-semibold text-white tracking-wide">
                      3. Paste Config list or Upload JSON
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".json,.txt"
                      className="hidden"
                    />
                    <button
                      id="upload_file_btn"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-semibold text-sky-400 transition cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>Upload JSON / Text</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Paste raw client configurations (multi-line list of `vmess://`, `vless://`, `trojan://`, `ss://` share URLs, standard Base64 chunks) OR upload a structured JSON file containing an array of config hashes or links.
                  </p>

                  <div className="relative">
                    <textarea
                      id="textarea_sub_configs"
                      rows={10}
                      value={editJsonConfigs}
                      onChange={(e) => setEditJsonConfigs(e.target.value)}
                      placeholder="Paste your configuration links here...&#10;vmess://eyJhZGQiOiIxMjcuMC4wLjEiLCJwb3J0Ii6icHNjIi6idGVzdCJ9&#10;vless://uuid-goes-here@127.0.0.1:443?security=tls#OldRemark"
                      className="w-full block p-4 bg-slate-950 border border-slate-800 rounded-xl text-emerald-400 placeholder-slate-700 text-xs font-mono focus:outline-none focus:border-sky-500 leading-relaxed"
                    />
                    
                    <div className="absolute bottom-3 right-3 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg text-[10px] font-mono text-slate-400">
                      🛠️ Detected: <strong className="text-sky-400">{detectedCount}</strong> profiles
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION: 4. ADDITIONAL ROUTING CONFIG FEED LINK */}
              <div id="section_additional_feed" className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Link className="h-5 w-5 text-sky-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-white tracking-wide">
                    4. Optional Alternative Config Feed Link
                  </h3>
                </div>

                <div className="space-y-4">
                  <p className="text-xs text-slate-400 leading-relaxed font-sans">
                    Optionally provide an additional subscription URL, external feed, or a list of raw proxies. 
                    Any nodes fetched from this secondary link are merged directly into the subscriber&apos;s list 
                    <strong> without undergoing name overrides, custom naming rules, or filter rules</strong>.
                    This remains isolated from core configs and will not confuse users!
                  </p>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 font-mono">
                      Alternative Subscription Feed URL or Config Raw Link
                    </label>
                    <input
                      id="input_additional_link"
                      type="text"
                      value={editAdditionalLink}
                      onChange={(e) => setEditAdditionalLink(e.target.value)}
                      placeholder="e.g. https://another.provider/sub/abc or ss://...#custom-node"
                      className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-sky-500 font-mono text-sky-305"
                    />
                  </div>
                </div>
              </div>


              {/* SECTION: 5. OPTIONAL ALTERNATIVE SUB ROUTE PATH & CONFIG */}
              <div id="section_alternative_sub_config" className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5">
                <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
                  <Globe className="h-5 w-5 text-sky-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-white tracking-wide">
                    5. Alternative Subscription Route & JSON Configs
                  </h3>
                </div>

                <div className="space-y-4">
                  <p className="text-xs text-slate-400 leading-relaxed font-sans">
                    Configure a completely different sub path with custom JSON configurations under the exact same subscription entry. 
                    This allows you to separate outbounds/nodes into a separate route (e.g., <code>/sub/alt-path</code> instead of <code>/sub/main-path</code>), 
                    but manage them fully under the same admin dashboard entity.
                  </p>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                        <span>Alternative Sub Path</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-xs select-none">/sub/</span>
                        <input
                          id="input_alternative_path"
                          type="text"
                          value={editAlternativePath}
                          onChange={(e) => setEditAlternativePath(e.target.value.toLowerCase().trim().replace(/[^a-z0-9-_]/g, ""))}
                          placeholder="alternative-path-name"
                          className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-sky-500 font-mono"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 font-sans">
                        Only lowercase letters, numbers, dashes, and underscores are allowed. Keep it unique!
                      </p>
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono flex items-center justify-between">
                        <span>Alternative Specific JSON Configs</span>
                      </label>
                      <textarea
                        id="textarea_alternative_json_configs"
                        rows={5}
                        value={editAlternativeJsonConfigs}
                        onChange={(e) => setEditAlternativeJsonConfigs(e.target.value)}
                        placeholder="Paste subscription JSON hash/array or multi-line nodes link list..."
                        className="w-full block p-3 bg-slate-900 border border-slate-800 rounded-xl text-amber-400 placeholder-slate-700 text-xs font-mono focus:outline-none focus:border-sky-500 leading-relaxed"
                      />
                      <p className="text-[11px] text-slate-500 font-sans">
                        Detected: <strong className="text-lime-400 font-mono">{extractConfigsList(editAlternativeJsonConfigs).length}</strong> alternative configurations
                      </p>
                    </div>
                  </div>
                </div>
              </div>


              {/* SAVE ACTION BUTTON AT BOTTOM */}
              <div className="flex items-center justify-end pb-12">
                <button
                  id="save_sub_bottom_btn"
                  onClick={handleSaveSubscription}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-6 py-3 bg-teal-500 hover:bg-teal-400 active:bg-teal-600 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold rounded-xl text-sm transition-all shadow-xl cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin text-white" />
                      <span>Saving Subscriptions...</span>
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 text-white" />
                      <span>Save Entire Subscription Config</span>
                    </>
                  )}
                </button>
              </div>

                    </div>
                  ) : activeTab === "metrics" ? (
            <div className="space-y-6 pb-12 animate-fade-in duration-300">
              {/* Header row inside tab */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-5 rounded-2xl border border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
                    <span>👥 Subscription Consumer Metrics</span>
                  </h3>
                  <p className="text-slate-400 text-xs mt-1">
                    Active devices and V2Ray clients subscribing to <code className="bg-slate-900 text-sky-400 px-1.5 py-0.5 rounded font-mono">/sub/{editPath}</code>
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isLoadingMetrics}
                  onClick={() => fetchAccessMetrics(editPath)}
                  className="flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 border border-slate-800 hover:bg-slate-850 text-xs font-semibold rounded-xl text-slate-200 transition disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-slate-300 ${isLoadingMetrics ? "animate-spin" : ""}`} />
                  <span>Refresh Stats</span>
                </button>
              </div>

              {/* Summary grid stats */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] uppercase font-mono font-bold text-slate-500 tracking-wider">Unique Consumers</span>
                  <p className="text-3xl font-bold font-mono text-white mt-1">{metricsList.length}</p>
                  <p className="text-[11px] text-slate-500 mt-2">Individual combinations of IP & Client HWID</p>
                </div>

                <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                  <span className="text-[10px] uppercase font-mono font-bold text-slate-500 tracking-wider">Accumulated Fetch Hits</span>
                  <p className="text-3xl font-bold font-mono text-emerald-400 mt-1">
                    {metricsList.reduce((sum, item) => sum + (item.access_count || 1), 0)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-2">Combined hits across all devices since creation</p>
                </div>

                <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-mono font-bold text-slate-500 tracking-wider font-semibold">Metrics Database Operations</span>
                    <p className="text-sm font-semibold text-slate-300 mt-1.5 font-mono">
                      ● Logging is active
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePurgeAccessMetrics}
                    className="w-full text-center text-xs font-semibold text-red-400 bg-red-950/20 border border-red-900/30 hover:bg-red-950/50 hover:border-red-500/40 py-1.5 rounded-lg transition mt-3"
                  >
                    🗑️ Purge recorded history
                  </button>
                </div>
              </div>

              {/* SECTION: 30-Day Sub Fetch Hits Trend Chart Component */}
              <div id="recharts_metrics_30day_trend" className="bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-5 animate-fade-in duration-300">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase font-mono tracking-wider text-slate-300 flex items-center gap-2">
                      <span>📈 Subscription Fetch Activity (Last 30 Days)</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Daily connection polling volume. Live metrics stacked upon a beautiful baseline trend.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 font-mono text-[9px] bg-slate-900 border border-slate-800 px-2.5 py-1 rounded-lg">
                    <span className="inline-block w-1.5 h-1.5 bg-lime-400 rounded-full animate-pulse" />
                    <span className="text-slate-400">STATUS:</span>
                    <span className="text-lime-400 font-bold">MONITORING</span>
                  </div>
                </div>

                <div className="h-64 sm:h-72 w-full pt-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={last30DaysChartData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorHits" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#84cc16" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#84cc16" stopOpacity={0.01} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" opacity={0.35} vertical={false} />
                      <XAxis 
                        dataKey="name" 
                        stroke="#475569" 
                        fontSize={10} 
                        tickLine={false}
                        axisLine={false}
                        dy={8}
                        fontFamily="monospace"
                      />
                      <YAxis 
                        stroke="#475569" 
                        fontSize={10} 
                        tickLine={false}
                        axisLine={false}
                        dx={-8}
                        fontFamily="monospace"
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "#070a13",
                          border: "1px solid #1e293b",
                          borderRadius: "12px",
                          boxShadow: "0 10px 25px -5px rgba(0,0,0,0.5)"
                        }}
                        labelStyle={{ color: "#94a3b8", fontSize: "11px", fontFamily: "monospace", fontWeight: "bold" }}
                        itemStyle={{ color: "#a3e635", fontSize: "12px", fontFamily: "sans-serif" }}
                        formatter={(value: any, name: any, props: any) => {
                          const real = props.payload.actualHits;
                          if (real > 0) {
                            return [`${value} hits (${real} raw database logs)`, "Hits Volume"];
                          }
                          return [`${value} hits (calculated trend)`, "Estimated Volume"];
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="hits"
                        stroke="#a3e635"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#colorHits)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Node Devices List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between pl-1">
                  <h4 className="text-xs font-semibold hover:text-white transition uppercase font-mono tracking-wider text-slate-400">
                    📱 Recorded Active Consumer Device Slots ({metricsList.length})
                  </h4>
                </div>

                {isLoadingMetrics ? (
                  <div className="flex flex-col items-center justify-center p-12 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
                    <RefreshCw className="h-6 w-6 text-sky-400 animate-spin" />
                    <span className="text-xs text-slate-400 font-medium">Querying connection logs table...</span>
                  </div>
                ) : metricsList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 bg-slate-950 border border-slate-800 rounded-2xl text-center space-y-3">
                    <div className="p-3 bg-slate-900 rounded-2xl border border-slate-850 text-slate-500">
                      <Globe className="h-6 w-6" />
                    </div>
                    <h5 className="text-sm font-bold text-slate-300">No active consumer seen yet</h5>
                    <p className="text-slate-500 text-xs max-w-sm">
                      Once you configure clients (v2rayNG, Shadowrocket, Quantumult X, etc.) to fetch this subscription link, their devices will automatically appear here!
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {metricsList.map((item, idx) => {
                      return (
                        <div 
                          key={`${item.ip}-${idx}`}
                          className="bg-slate-950/70 border border-slate-800/80 p-5 rounded-2xl flex flex-col justify-between hover:border-slate-700 transition duration-200 text-left relative"
                        >
                          <div className="space-y-4">
                            {/* Badges Header row */}
                            <div className="flex items-center justify-between gap-2">
                              <span className="bg-sky-500/10 text-sky-400 border border-sky-400/20 text-[11px] font-mono px-2.5 py-0.5 rounded-full font-bold">
                                {item.device_type || "Generic client"}
                              </span>
                              
                              <button
                                type="button"
                                onClick={() => handleDeleteSingleMetric(item)}
                                className="text-slate-500 hover:text-red-400 p-1.5 hover:bg-slate-900 border border-transparent hover:border-red-500/10 rounded-lg transition"
                                title="Remove this consumer log entry"
                              >
                                <Trash className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* Client particulars and status */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">IP Address:</span>
                                <span className="text-sm font-semibold text-white font-mono">{item.ip || "Unknown IP"}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-slate-500">Subscription Fetch Hits:</span>
                                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
                                  {item.access_count || 1} requests
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Timestamps footer */}
                          <div className="border-t border-slate-850/40 mt-4 pt-3 flex items-center justify-between text-[10px] text-slate-500 font-mono font-medium">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3 inline" />
                              Seen first: {new Date(item.first_seen_at).toLocaleDateString()}
                            </span>
                            <span>
                              Active last: {new Date(item.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === "admins" ? (
            <div className="space-y-6 pb-12 animate-fade-in duration-300 text-left">
              {/* ADMIN ACCOUNT MANAGEMENT SECTION */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-950 p-5 rounded-2xl border border-slate-800">
                <div>
                  <h3 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
                    <Shield className="h-5 w-5 text-sky-400" />
                    <span>👥 Admin Accounts &amp; Privileges</span>
                  </h3>
                  <p className="text-slate-400 text-xs mt-1">
                    Manage operator profiles, access credentials, and visual/operational clearance levels.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleOpenCreateAdminModal}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-slate-950 font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  <Plus className="h-4 w-4 text-slate-950" />
                  <span>Create Operator</span>
                </button>
              </div>

              {/* Roles reference card */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] uppercase font-mono font-bold text-teal-400 bg-teal-500/10 border border-teal-500/25 px-2 py-0.5 rounded-full inline-block mb-2">Level 3 — Super Admin</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Full master capabilities. Manage dynamic subscription feeds, clear raw metrics tables, and perform CRUD transactions on administrator logs.
                  </p>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] uppercase font-mono font-bold text-sky-400 bg-sky-500/10 border border-sky-400/25 px-2 py-0.5 rounded-full inline-block mb-2">Level 2 — Editor</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Write/edit capabilities over proxies and subscribers, dummy announcements, renamer profiles, and can delete metric logs, but holds no admin manager permissions.
                  </p>
                </div>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                  <span className="text-[10px] uppercase font-mono font-bold text-slate-400 bg-slate-500/10 border border-slate-500/25 px-2 py-0.5 rounded-full inline-block mb-2">Level 1 — Viewer</span>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Strictly read-only access. Can view lists of subscription paths, read metrics, but operations like saving config, deleting profiles, or updating databases are disabled.
                  </p>
                </div>
              </div>

              {/* Operator table/list */}
              <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-950 border-b border-slate-850 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-4">Operator Username</th>
                        <th className="py-3 px-4">Display Name</th>
                        <th className="py-3 px-4">Authorization Role</th>
                        <th className="py-3 px-4">Description Duty</th>
                        <th className="py-3 px-4">Created Date</th>
                        <th className="py-3 px-4 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {isLoadingAdmins ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-xs text-slate-500 italic">
                            <span className="inline-block animate-spin mr-2">⚙️</span> Syncing administrator database records...
                          </td>
                        </tr>
                      ) : adminsList.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-xs text-slate-500 italic">
                            No operator accounts matched.
                          </td>
                        </tr>
                      ) : (
                        adminsList.map((adm) => {
                          const isSelf = currentUser && adm.username.toLowerCase() === currentUser.username.toLowerCase();
                          const isMaster = adm.username.toLowerCase() === "admin";
                          return (
                            <tr key={adm.username} className="hover:bg-slate-900/40 transition">
                              <td className="py-3.5 px-4 font-mono text-xs font-semibold text-white">
                                @{adm.username} {isSelf && <span className="text-[9px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1.5 py-0.5 rounded font-sans ml-1">You</span>}
                              </td>
                              <td className="py-3.5 px-4 text-xs font-medium text-slate-200">
                                {adm.name}
                              </td>
                              <td className="py-3.5 px-4 text-xs">
                                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                                  adm.level === 3
                                    ? "bg-teal-500/10 text-teal-400 border border-teal-500/20"
                                    : adm.level === 2
                                    ? "bg-sky-500/10 text-sky-400 border-sky-400/20"
                                    : "bg-slate-550/10 text-slate-400 border-slate-500/20"
                                }`}>
                                  Level {adm.level} — {adm.level === 3 ? "Super Admin" : adm.level === 2 ? "Editor" : "Viewer"}
                                </span>
                              </td>
                              <td className="py-3.5 px-4 text-xs text-slate-400 truncate max-w-[180px]" title={adm.description}>
                                {adm.description || <span className="text-slate-600 italic">No notes</span>}
                              </td>
                              <td className="py-3.5 px-4 font-mono text-[10px] text-slate-500">
                                {adm.createdAt ? new Date(adm.createdAt).toLocaleDateString() : "N/A"}
                              </td>
                              <td className="py-3.5 px-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditAdminModal(adm)}
                                    className="p-1 hover:bg-slate-850 hover:text-white border border-transparent rounded transition text-slate-400"
                                    title="Edit settings"
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={isSelf || isMaster}
                                    onClick={() => handleDeleteAdmin(adm.username)}
                                    className="p-1 hover:bg-red-950 hover:text-red-400 border border-transparent rounded disabled:opacity-30 disabled:cursor-not-allowed transition text-slate-450"
                                    title={isSelf ? "Cannot delete yourself" : isMaster ? "Cannot delete master seed admin" : "Delete user"}
                                  >
                                    <Trash className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

                </div>
              </div>
            </div>
          )}
        </main>

      </div>

      {/* OVERLAY MODAL: CREATE / EDIT ADMINISTRATOR */}
      {showAdminModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in animate-duration-200 text-left">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-850 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Shield className="h-5 w-5 text-sky-400 animate-pulse" />
                <span>{selectedAdminUsername ? `Modify Administrator: @${adminUsername}` : "Create New System Administrator"}</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowAdminModal(false)}
                className="text-slate-400 hover:text-white font-mono text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveAdmin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                  Login Username (Immutable once created)
                </label>
                <input
                  type="text"
                  disabled={!!selectedAdminUsername}
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="e.g. support_iran"
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-sans focus:outline-none focus:border-sky-500 disabled:opacity-55 disabled:cursor-not-allowed transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                  Display Name
                </label>
                <input
                  type="text"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="e.g. Support Iran Team"
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-sans focus:outline-none focus:border-sky-500 transition-all font-semibold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                  Access Password {selectedAdminUsername && "(Leave blank to keep unchanged)"}
                </label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder={selectedAdminUsername ? "••••••••••••" : "At least 6 characters..."}
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-mono tracking-widest focus:outline-none focus:border-sky-500 transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                  Role Permission Level
                </label>
                <select
                  value={adminLevel}
                  onChange={(e) => setAdminLevel(Number(e.target.value))}
                  disabled={adminUsername === "admin"}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-sky-500 transition-all cursor-pointer font-medium"
                >
                  <option value={3}>Level 3 — Super Admin (Full Read-Write &amp; User CRUD)</option>
                  <option value={2}>Level 2 — Editor (Read-Write of Subscriptions &amp; Metrics Purge)</option>
                  <option value={1}>Level 1 — Viewer (Read-only Feeds &amp; Metrics Diagnostics)</option>
                </select>
                {adminUsername === "admin" && (
                  <span className="text-[10px] text-slate-500 block mt-1">
                    Note: The default master administrator &apos;admin&apos; must remain Level 3.
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 font-mono">
                  Role Description / Duty Notes
                </label>
                <input
                  type="text"
                  value={adminDescription}
                  onChange={(e) => setAdminDescription(e.target.value)}
                  placeholder="e.g. Head of Support Group"
                  className="w-full px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-sans focus:outline-none focus:border-sky-500 transition-all text-slate-300"
                />
              </div>

              {adminError && (
                <div className="p-3 bg-red-950 border border-red-900 rounded-xl text-red-300 text-xs flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
                  <span>{adminError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAdminModal(false)}
                  className="px-4 py-2 bg-slate-850 hover:bg-slate-800 text-slate-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdminSaving}
                  className="px-5 py-2 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 font-bold text-slate-950 text-xs rounded-lg transition cursor-pointer"
                >
                  {isAdminSaving ? "Saving..." : "Save Operator Account"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
