'use client'

import DashboardLayout from '@/components/dashboard-layout'
import { Button } from '@/components/ui/button'
import { Bell, Mail, Lock, Shield, Zap } from 'lucide-react'
import { useState } from 'react'

export default function SettingsPage() {
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(true)
  const [newLeadsNotification, setNewLeadsNotification] = useState(true)

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-2xl">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold mb-2">Settings</h1>
          <p className="text-foreground/60">Manage your account and preferences.</p>
        </div>

        {/* Account Settings */}
        <div className="bg-card rounded-xl border border-border/40 p-6 space-y-6">
          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Account Settings
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Full Name</label>
                <input 
                  type="text" 
                  defaultValue="John Doe"
                  className="w-full px-4 py-2 rounded-lg border border-border bg-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Email Address</label>
                <input 
                  type="email" 
                  defaultValue="john@example.com"
                  className="w-full px-4 py-2 rounded-lg border border-border bg-secondary text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Current Password</label>
                <input 
                  type="password" 
                  placeholder="••••••••"
                  className="w-full px-4 py-2 rounded-lg border border-border bg-secondary text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <Button>Save Changes</Button>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-card rounded-xl border border-border/40 p-6 space-y-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Bell className="w-5 h-5" />
            Notification Settings
          </h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg hover:bg-secondary transition">
              <div>
                <p className="font-medium">New Leads</p>
                <p className="text-sm text-foreground/60">Get notified when new leads match your criteria</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={newLeadsNotification}
                  onChange={(e) => setNewLeadsNotification(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
              </label>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg hover:bg-secondary transition">
              <div>
                <p className="font-medium">Email Notifications</p>
                <p className="text-sm text-foreground/60">Receive updates via email</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={emailNotifications}
                  onChange={(e) => setEmailNotifications(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
              </label>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg hover:bg-secondary transition">
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-sm text-foreground/60">Get push notifications on your device</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={pushNotifications}
                  onChange={(e) => setPushNotifications(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-secondary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-primary/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-background after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
              </label>
            </div>
          </div>
        </div>

        {/* Platform Preferences */}
        <div className="bg-card rounded-xl border border-border/40 p-6 space-y-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Platform Preferences
          </h2>

          <div className="space-y-4">
            {[
              { name: 'Upwork', checked: true },
              { name: 'Twitter', checked: true },
              { name: 'Discord', checked: false },
            ].map((platform) => (
              <div key={platform.name} className="flex items-center gap-3 p-4 rounded-lg hover:bg-secondary transition">
                <input 
                  type="checkbox" 
                  defaultChecked={platform.checked}
                  className="w-4 h-4 rounded border-border"
                />
                <span className="font-medium">{platform.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-6 space-y-4">
          <h2 className="text-xl font-bold text-destructive flex items-center gap-2">
            <Lock className="w-5 h-5" />
            Danger Zone
          </h2>
          
          <p className="text-sm text-foreground/60">
            Actions below are irreversible. Please proceed with caution.
          </p>

          <div className="space-y-3">
            <Button variant="outline" className="w-full text-destructive border-destructive/50 hover:bg-destructive/10">
              Delete Account
            </Button>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
