import React, { useState } from "react";
import axios from "axios";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setUserDetail } from "../features/user/userSlice";

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || "http://localhost:4000") + "/api";
const CHANGE_PASSWORD_URL = `${API_BASE}/users/update`;

type ForcePasswordChangeModalProps = {
  onSuccess: () => void
}

const ForcePasswordChangeModal: React.FC<ForcePasswordChangeModalProps> = ({ onSuccess }) => {
  const dispatch = useAppDispatch();
  const userDetail = useAppSelector((state) => state.user.userDetail);
  const token = useAppSelector((state) => state.auth.token);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setError("Le mot de passe doit contenir au moins un chiffre.");
      return;
    }
    if (!/[^a-zA-Z0-9]/.test(newPassword)) {
      setError("Le mot de passe doit contenir au moins un symbole (ex: @, #, !, ...).");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      await axios.post(
        CHANGE_PASSWORD_URL,
        { id: userDetail?.userId, password: newPassword, pass_change: true },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      // Mettre à jour pass_change = 1 dans le store + localStorage
      if (userDetail) {
        dispatch(setUserDetail({ ...userDetail, pass_change: 1 }));
      }
      onSuccess();
    } catch (err: any) {
      const message =
        err?.response?.data?.message || err.message || "Erreur lors du changement de mot de passe.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontSize: 15,
    outline: "none",
    background: "#f8fafc",
    color: "#0f172a",
    boxSizing: "border-box",
  };

  const eyeBtnStyle: React.CSSProperties = {
    position: "absolute",
    right: 12,
    top: "50%",
    transform: "translateY(-50%)",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "#94a3b8",
    fontSize: 16,
    padding: 0,
    lineHeight: 1,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: "40px 36px 32px",
          width: "100%",
          maxWidth: 420,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        {/* Icône */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(239, 68, 68, 0.1)",
              marginBottom: 12,
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#0f172a" }}>
            Changement de mot de passe requis
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748b" }}>
            Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Nouveau mot de passe */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Nouveau mot de passe
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 caractères"
                style={inputStyle}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                style={eyeBtnStyle}
                onClick={() => setShowNew((v) => !v)}
                tabIndex={-1}
              >
                {showNew ? "🙈" : "👁"}
              </button>
            </div>
            {/* Indicateurs de règles */}
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 2 }}>
              {[
                { label: "Au moins 6 caractères", ok: newPassword.length >= 6 },
                { label: "Au moins un chiffre (0-9)", ok: /[0-9]/.test(newPassword) },
                { label: "Au moins un symbole (@, #, !, ...)", ok: /[^a-zA-Z0-9]/.test(newPassword) },
              ].map(({ label, ok }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <span style={{ color: ok ? "#22c55e" : "#94a3b8", fontWeight: 700, fontSize: 14, lineHeight: 1 }}>
                    {ok ? "✓" : "○"}
                  </span>
                  <span style={{ color: ok ? "#16a34a" : "#94a3b8" }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Confirmation */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
              Confirmer le mot de passe
            </label>
            <div style={{ position: "relative" }}>
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Répétez le mot de passe"
                style={inputStyle}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                style={eyeBtnStyle}
                onClick={() => setShowConfirm((v) => !v)}
                tabIndex={-1}
              >
                {showConfirm ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {/* Erreur */}
          {error && (
            <div
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13,
                color: "#dc2626",
              }}
            >
              {error}
            </div>
          )}

          {/* Bouton */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "12px",
              borderRadius: 8,
              border: "none",
              background: loading ? "#94a3b8" : "#0f172a",
              color: "#fff",
              fontSize: 15,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              marginTop: 4,
              transition: "background 0.2s",
            }}
          >
            {loading ? "Enregistrement..." : "Définir mon mot de passe"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ForcePasswordChangeModal;
