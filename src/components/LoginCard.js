import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Logo from "./Logo";
export default function LoginCard({ onLogin, isAuthenticating, error, allowGuests, onGuestLogin, }) {
    return (_jsxs("div", { className: "min-h-screen flex flex-col gap-9 items-center justify-center bg-linear-to-br from-slate-950 to-slate-900 p-6", style: {
            backgroundImage: 'url(/loginBackground.svg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
        }, children: [_jsx("div", { className: "flex flex-col items-center justify-center h-full text-6xl font-bold text-white", children: "AI Matic" }), _jsxs(Card, { className: "w-full max-w-md bg-white/5 backdrop-blur-lg border-white/10 text-white shadow-2xl p-6", children: [_jsxs(CardHeader, { className: "space-y-4 text-center", children: [_jsx("div", { className: "flex justify-center", children: _jsx(Logo, { className: "w-16 h-16 text-blue-600" }) }), _jsxs("div", { className: "space-y-2", children: [_jsx(CardTitle, { className: "text-3xl font-bold tracking-tighter", children: "Welcome back" }), _jsx(CardDescription, { className: "text-slate-400", children: "Sign in with your allowlisted Google account to continue." })] })] }), _jsxs(CardContent, { className: "space-y-4", children: [_jsx(Button, { className: "w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold", onClick: onLogin, disabled: isAuthenticating, children: isAuthenticating ? "Redirecting..." : "Continue with Google" }), allowGuests && onGuestLogin && (_jsx(Button, { variant: "outline", className: "w-full border-white/20 text-white hover:bg-white/10 hover:text-white", onClick: onGuestLogin, disabled: isAuthenticating, children: "Continue as Guest" })), error && (_jsx("p", { className: "text-sm text-orange-500 text-center", children: error }))] })] })] }));
}
