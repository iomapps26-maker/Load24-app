import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Truck, Loader2, Eye, EyeOff, CheckCircle, Gift, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { supabase } from '@/api/base44Client';
import { toast } from 'sonner';

export default function MobileSignup() {
  const [step, setStep] = useState(1); // 1: details, 2: otp verification, 3: success
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [createPassword, setCreatePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  // Check for referral code in URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const ref = urlParams.get('ref');
    if (ref) {
      setReferralCode(ref);
    }
  }, []);

  const handleSignup = async () => {
    if (!mobile || mobile.length !== 10) {
      toast.error('कृपया सही 10-अंकों का मोबाइल नंबर दर्ज करें');
      return;
    }
    if (!email) {
      toast.error('कृपया सही ईमेल पता दर्ज करें');
      return;
    }
    if (!fullName) {
      toast.error('कृपया अपना पूरा नाम दर्ज करें');
      return;
    }
    if (createPassword) {
      if (!password || password.length < 6) {
        toast.error('पासवर्ड कम से कम 6 अक्षरों का होना चाहिए');
        return;
      }
      if (password !== confirmPassword) {
        toast.error('पासवर्ड मेल नहीं खाते');
        return;
      }
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      toast.success('OTP भेज दिया गया है!');
      setStep(2);
    } catch (err) {
      toast.error(err.message || 'OTP भेजने में विफल');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp || otp.length !== 6) {
      toast.error('कृपया 6-अंकों का OTP दर्ज करें');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'email' });
      if (error) throw error;
      toast.success('ईमेल सफलतापूर्वक वेरिफाई हो गया!');
      setStep(3);
    } catch (err) {
      toast.error(err.message || 'OTP वेरिफिकेशन विफल। कृपया पुनः प्रयास करें।');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) throw error;
      toast.success('OTP फिर से भेज दिया गया है!');
    } catch (err) {
      toast.error(err.message || 'कुछ गलत हो गया।');
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
            {step === 1 && 'नया खाता बनाएं / Create New Account'}
            {step === 2 && 'OTP वेरिफाई करें / Verify OTP'}
            {step === 3 && 'Welcome to LOAD24!'}
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name / पूरा नाम *</label>
                <Input
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="text-lg"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Mobile Number / मोबाइल नंबर *</label>
                <Input
                  type="tel"
                  placeholder="10-digit mobile number"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  className="text-lg"
                  maxLength={10}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Email / ईमेल *</label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value.trim())}
                  className="text-lg"
                />
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" />
                  आपको ईमेल पर OTP भेजा जाएगा
                </p>
              </div>

              {referralCode && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-green-800">
                    <Gift className="h-5 w-5" />
                    <span className="font-medium">Referral Code Applied: {referralCode}</span>
                  </div>
                  <p className="text-sm text-green-700 mt-1">
                    You'll get ₹500 bonus after your first deal!
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Referral Code (Optional) / रेफरल कोड (वैकल्पिक)
                </label>
                <Input
                  placeholder="Enter referral code"
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                  className="text-lg"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Checkbox
                  id="createPassword"
                  checked={createPassword}
                  onCheckedChange={setCreatePassword}
                />
                <label htmlFor="createPassword" className="text-sm cursor-pointer">
                  Create password (optional) / पासवर्ड बनाएं (वैकल्पिक)
                </label>
              </div>

              {createPassword && (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Password / पासवर्ड *</label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="At least 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="text-lg pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Confirm Password / पासवर्ड की पुष्टि करें *</label>
                    <Input
                      type="password"
                      placeholder="Re-enter password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="text-lg"
                    />
                  </div>
                </>
              )}

              <Button
                className="w-full bg-orange-500 hover:bg-orange-600"
                onClick={handleSignup}
                disabled={isLoading || !mobile || !email || !fullName || (createPassword && (!password || password !== confirmPassword))}
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  'Continue / जारी रखें'
                )}
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm mb-2">
                <p className="text-green-800 font-medium">OTP भेज दिया गया ✅</p>
                <p className="text-green-700 text-xs mt-1">
                  {email} पर ईमेल चेक करें और OTP दर्ज करें।
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Enter OTP / OTP दर्ज करें</label>
                <p className="text-xs text-slate-500">ईमेल पर भेजा गया — {email}</p>
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
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  'Verify & Continue / वेरिफाई करें'
                )}
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={handleResendOTP}
                disabled={isLoading}
              >
                Resend OTP / OTP फिर से भेजें
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setStep(1);
                  setOtp('');
                }}
              >
                Go Back / वापस जाएं
              </Button>
            </>
          )}

          {step === 3 && (
            <>
              <div className="text-center py-6">
                <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="h-10 w-10 text-green-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">
                  Email Verified Successfully!
                </h3>
                <p className="text-slate-600">
                  आपका ईमेल वेरिफाई हो गया है। अब आप लॉगिन कर सकते हैं।
                </p>
              </div>

              <Link to={createPageUrl('ProfileSetup')}>
                <Button className="w-full bg-orange-500 hover:bg-orange-600">
                  Complete Profile Setup / प्रोफाइल पूरा करें
                </Button>
              </Link>
            </>
          )}

          {step !== 3 && (
            <div className="text-center pt-4">
              <p className="text-sm text-slate-600 mb-2">
                Already have an account? / पहले से खाता है?
              </p>
              <Link to={createPageUrl('MobileLogin')}>
                <Button variant="link" className="text-orange-600">
                  Login / लॉगिन करें
                </Button>
              </Link>
            </div>
          )}

          <div className="text-center text-xs text-slate-500 pt-2">
            By signing up, you agree to our{' '}
            <Link to={createPageUrl('TermsOfService')} className="text-orange-600">Terms of Service</Link>
            {' '}and{' '}
            <Link to={createPageUrl('PrivacyPolicy')} className="text-orange-600">Privacy Policy</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}