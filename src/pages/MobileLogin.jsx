import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Truck, Loader2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { supabase } from '@/api/base44Client';
import { toast } from 'sonner';

export default function MobileLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('email'); // 'email' | 'otp'
  const [isLoading, setIsLoading] = useState(false);

  const handleSendOTP = async () => {
    if (!email) {
      toast.error('Please enter a valid email address');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      toast.success('OTP sent');
      setStep('otp');
    } catch (err) {
      toast.error(err.message || 'Failed to send OTP');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp || otp.length !== 6) {
      toast.error('Please enter the 6-digit OTP');
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
      if (error) throw error;
      navigate(createPageUrl('Dashboard'));
    } catch (err) {
      toast.error(err.message || 'Invalid OTP');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-blue-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="bg-orange-500 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Truck className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-2xl">
            LOAD<span className="text-orange-500">24</span>
          </CardTitle>
          <p className="text-sm text-slate-600 mt-2">
            {step === 'email' ? 'ईमेल से लॉगिन करें' : 'OTP वेरिफाई करें'}
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 'email' ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email / ईमेल</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                  className="text-lg"
                />
              </div>

              <Button
                className="w-full bg-orange-500 hover:bg-orange-600"
                onClick={handleSendOTP}
                disabled={isLoading || !email}
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Send OTP / OTP भेजें'}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Enter OTP / OTP दर्ज करें</label>
                <p className="text-xs text-slate-500">Sent to {email}</p>
                <Input
                  type="tel"
                  placeholder="6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-lg text-center tracking-widest"
                  maxLength={6}
                />
              </div>

              <Button
                className="w-full bg-orange-500 hover:bg-orange-600"
                onClick={handleVerifyOTP}
                disabled={isLoading || otp.length !== 6}
              >
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Verify & Login / वेरिफाई करें और लॉगिन करें'}
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => { setStep('email'); setOtp(''); }}
              >
                Change Email / ईमेल बदलें
              </Button>
            </>
          )}

          <div className="text-center pt-4">
            <p className="text-sm text-slate-600 mb-2">
              Don't have an account? / खाता नहीं है?
            </p>
            <Link to={createPageUrl('MobileSignup')}>
              <Button variant="outline" className="w-full border-orange-300 text-orange-600">
                Create Account / खाता बनाएं
              </Button>
            </Link>
          </div>

          <div className="text-center text-xs text-slate-500 pt-2">
            By continuing, you agree to our{' '}
            <Link to={createPageUrl('TermsOfService')} className="text-orange-600">Terms of Service</Link>
            {' '}and{' '}
            <Link to={createPageUrl('PrivacyPolicy')} className="text-orange-600">Privacy Policy</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
