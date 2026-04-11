'use client';
import Link from 'next/link';
import {
  Zap, Github, Upload, Cpu, Shield, Download,
  CheckCircle, ArrowRight, Terminal, RefreshCw,
} from 'lucide-react';

const features = [
  {
    icon: Upload,
    title: 'Multi-source Ingestion',
    description: 'Upload a ZIP, paste a GitHub URL, or connect via OAuth. Your project, your way.',
  },
  {
    icon: Cpu,
    title: 'AI AutoFix',
    description: 'Intelligent error detection and automatic repair using Claude AI. Build → Fix → Rebuild in seconds.',
  },
  {
    icon: Terminal,
    title: 'Live Build Console',
    description: 'Watch your build in real-time with streaming logs, progress indicators and fix timelines.',
  },
  {
    icon: Download,
    title: 'Instant APK Download',
    description: 'Download your APK directly or share via a public link + QR code for easy sideloading.',
  },
  {
    icon: Shield,
    title: 'Secure Sandboxing',
    description: 'Every build runs in an isolated Docker container with CPU/RAM limits and automatic cleanup.',
  },
  {
    icon: RefreshCw,
    title: 'Auto Repair Loop',
    description: 'Up to 3 automatic fix cycles. Dependency conflicts, SDK mismatches, manifest errors — all handled.',
  },
];

const steps = [
  { step: '01', title: 'Upload or Link', desc: 'Drop a ZIP or paste your GitHub repo URL' },
  { step: '02', title: 'Auto Analysis', desc: 'We detect project type, SDK, Gradle version and score compatibility' },
  { step: '03', title: 'Build & Fix', desc: 'Gradle builds run in Docker; AI fixes errors automatically' },
  { step: '04', title: 'Download APK', desc: 'Get your APK with a direct download link and QR code' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-500 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">APK Factory</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link href="/auth/login" className="text-gray-400 hover:text-white transition-colors text-sm">
              Sign in
            </Link>
            <Link
              href="/auth/register"
              className="bg-green-500 hover:bg-green-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Get Started Free
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/30 rounded-full px-4 py-1.5 mb-8">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          <span className="text-green-400 text-sm font-medium">No Android Studio required</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
          ZIP / GitHub / AI
          <br />
          <span className="bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent">
            → APK in 1 click
          </span>
        </h1>

        <p className="text-xl text-gray-400 max-w-2xl mx-auto mb-10">
          APK Factory automatically builds, fixes and packages your Android projects.
          No setup. No configuration. Just results.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            href="/auth/register"
            className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 text-white px-8 py-4 rounded-xl text-lg font-semibold transition-colors shadow-lg shadow-green-500/20"
          >
            Build Your APK <ArrowRight className="w-5 h-5" />
          </Link>
          <Link
            href="/dashboard"
            className="flex items-center justify-center gap-2 border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white px-8 py-4 rounded-xl text-lg transition-colors"
          >
            <Github className="w-5 h-5" /> Import from GitHub
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-8 max-w-lg mx-auto mt-16 text-center">
          {[
            { value: '< 5 min', label: 'Avg build time' },
            { value: '3x', label: 'Auto-fix cycles' },
            { value: '100%', label: 'Sandboxed' },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-bold text-white">{value}</div>
              <div className="text-sm text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Terminal Demo */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="rounded-2xl overflow-hidden border border-gray-800 shadow-2xl">
          <div className="bg-gray-900 px-4 py-3 flex items-center gap-2 border-b border-gray-800">
            <div className="flex gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-gray-500 text-sm ml-2 font-mono">Build Console — my-android-app</span>
          </div>
          <div className="bg-gray-950 p-6 font-mono text-sm space-y-1">
            {[
              { t: 'info', m: '> Task :app:preBuild' },
              { t: 'info', m: '> Task :app:compileDebugKotlin' },
              { t: 'error', m: 'error: Could not resolve com.squareup.retrofit2:retrofit:3.0.0' },
              { t: 'warn',  m: '⚠ AI AutoFix activated — analyzing error...' },
              { t: 'info',  m: '✓ Fix applied: Updated retrofit to stable version 2.9.0' },
              { t: 'info',  m: '↺ Rebuilding...' },
              { t: 'info',  m: '> Task :app:packageDebug' },
              { t: 'success', m: 'BUILD SUCCESSFUL in 2m 34s' },
              { t: 'success', m: '✓ APK ready — app-debug.apk (4.2 MB)' },
            ].map(({ t, m }, i) => (
              <div
                key={i}
                className={`${
                  t === 'error' ? 'text-red-400' :
                  t === 'warn' ? 'text-yellow-400' :
                  t === 'success' ? 'text-green-400' : 'text-gray-400'
                }`}
              >
                {m}
              </div>
            ))}
            <span className="text-green-400 cursor-blink">█</span>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-7xl mx-auto px-6 pb-24">
        <h2 className="text-3xl font-bold text-white text-center mb-4">How it works</h2>
        <p className="text-gray-400 text-center mb-12">From source to APK in 4 simple steps</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {steps.map(({ step, title, desc }) => (
            <div key={step} className="relative">
              <div className="glass rounded-2xl p-6">
                <div className="text-4xl font-bold text-green-500/30 mb-4">{step}</div>
                <h3 className="text-white font-semibold mb-2">{title}</h3>
                <p className="text-gray-400 text-sm">{desc}</p>
              </div>
              {step !== '04' && (
                <ArrowRight className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-700 z-10" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="bg-gray-900/50 border-y border-gray-800">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <h2 className="text-3xl font-bold text-white text-center mb-4">Everything you need</h2>
          <p className="text-gray-400 text-center mb-12">Built for indie hackers, AI developers and entrepreneurs</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {features.map(({ icon: Icon, title, description }) => (
              <div key={title} className="glass rounded-2xl p-6 hover:border-green-500/30 transition-colors">
                <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-green-400" />
                </div>
                <h3 className="text-white font-semibold mb-2">{title}</h3>
                <p className="text-gray-400 text-sm">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <h2 className="text-3xl font-bold text-white text-center mb-4">Simple pricing</h2>
        <p className="text-gray-400 text-center mb-12">Start free, scale when you need to</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
          {[
            {
              name: 'Free',
              price: '$0',
              period: 'forever',
              features: ['5 builds / month', 'Debug APK only', 'AI AutoFix (basic)', '500MB project size', 'Community support'],
              cta: 'Get Started',
              href: '/auth/register',
              highlight: false,
            },
            {
              name: 'Pro',
              price: '$19',
              period: 'per month',
              features: ['Unlimited builds', 'Debug + Release + AAB', 'AI AutoFix (advanced)', '2GB project size', 'Priority queue', 'Custom keystore', 'Priority support'],
              cta: 'Start Pro Trial',
              href: '/auth/register?plan=pro',
              highlight: true,
            },
          ].map(({ name, price, period, features, cta, href, highlight }) => (
            <div
              key={name}
              className={`rounded-2xl p-8 border ${
                highlight
                  ? 'border-green-500/50 bg-green-500/5 relative'
                  : 'border-gray-800 bg-gray-900/50'
              }`}
            >
              {highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                  MOST POPULAR
                </div>
              )}
              <div className="mb-6">
                <div className="text-gray-400 text-sm mb-1">{name}</div>
                <div className="text-4xl font-bold text-white">{price}</div>
                <div className="text-gray-500 text-sm">{period}</div>
              </div>
              <ul className="space-y-3 mb-8">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-gray-300">
                    <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={href}
                className={`block text-center py-3 rounded-xl font-medium transition-colors ${
                  highlight
                    ? 'bg-green-500 hover:bg-green-400 text-white'
                    : 'border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white'
                }`}
              >
                {cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-800 bg-gray-900/30">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-gradient-to-br from-green-400 to-blue-500 rounded-md flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="text-gray-400 text-sm">APK Factory</span>
          </div>
          <p className="text-gray-500 text-sm">ZIP / GitHub / AI → APK in 1 click</p>
        </div>
      </footer>
    </div>
  );
}
