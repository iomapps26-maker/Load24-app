import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  ArrowLeft,
  ArrowUpCircle,
  ArrowDownCircle,
  Receipt,
  Clock,
  CheckCircle,
  XCircle,
  Loader2
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { format } from 'date-fns';

export default function TransactionHistory() {
  const navigate = useNavigate();
  const [language, setLanguage] = useState('hi');

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: () => base44.auth.me()
  });

  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ['walletTransactions', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      return await base44.entities.WalletTransaction.filter(
        { user_email: user.email },
        '-created_date'
      );
    },
    enabled: !!user?.email
  });

  const t = {
    en: {
      title: 'Transaction History',
      noTransactions: 'No transactions yet',
      credit: 'Credit',
      debit: 'Debit',
      pending: 'Pending',
      completed: 'Completed',
      failed: 'Failed',
      reversed: 'Reversed',
      categories: {
        deal_payment: 'Deal Payment',
        advance_payment: 'Advance',
        balance_payment: 'Balance',
        commission: 'Commission',
        refund: 'Refund',
        withdrawal: 'Withdrawal',
        deposit: 'Deposit',
        penalty: 'Penalty',
        bonus: 'Bonus'
      }
    },
    hi: {
      title: 'Transaction History',
      noTransactions: 'अभी तक कोई transaction नहीं',
      credit: 'Credit',
      debit: 'Debit',
      pending: 'Pending',
      completed: 'पूर्ण',
      failed: 'विफल',
      reversed: 'वापस',
      categories: {
        deal_payment: 'Deal भुगतान',
        advance_payment: 'Advance',
        balance_payment: 'Balance',
        commission: 'Commission',
        refund: 'Refund',
        withdrawal: 'Withdrawal',
        deposit: 'Deposit',
        penalty: 'Penalty',
        bonus: 'Bonus'
      }
    }
  };

  const text = t[language];

  const getStatusBadge = (status) => {
    const statusConfig = {
      pending: { variant: 'outline', icon: Clock, color: 'text-yellow-600' },
      completed: { variant: 'default', icon: CheckCircle, color: 'text-green-600' },
      failed: { variant: 'destructive', icon: XCircle, color: 'text-red-600' },
      reversed: { variant: 'secondary', icon: ArrowDownCircle, color: 'text-slate-600' }
    };

    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="h-3 w-3" />
        {text[status]}
      </Badge>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-500 to-blue-600 text-white sticky top-0 z-50 shadow-lg">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/20"
              onClick={() => navigate(createPageUrl('MyWallet'))}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <Receipt className="h-6 w-6" />
              <h1 className="text-xl font-bold">{text.title}</h1>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-white hover:bg-white/20"
            onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')}
          >
            {language === 'en' ? 'हिंदी' : 'EN'}
          </Button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {transactions.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Receipt className="h-16 w-16 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500">{text.noTransactions}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {transactions.map((txn) => {
              const isCredit = txn.type === 'credit';
              const Icon = isCredit ? ArrowDownCircle : ArrowUpCircle;
              const amountColor = isCredit ? 'text-green-600' : 'text-red-600';

              return (
                <Card key={txn.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-full ${isCredit ? 'bg-green-100' : 'bg-red-100'}`}>
                          <Icon className={`h-5 w-5 ${amountColor}`} />
                        </div>
                        <div>
                          <div className="font-semibold">
                            {text.categories[txn.category] || txn.category}
                          </div>
                          {txn.description && (
                            <div className="text-sm text-slate-600 mt-1">
                              {txn.description}
                            </div>
                          )}
                          <div className="text-xs text-slate-500 mt-1">
                            {format(new Date(txn.created_date), 'dd MMM yyyy, hh:mm a')}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-xl font-bold ${amountColor}`}>
                          {isCredit ? '+' : '-'}₹{txn.amount?.toLocaleString('en-IN')}
                        </div>
                        <div className="mt-1">
                          {getStatusBadge(txn.status)}
                        </div>
                      </div>
                    </div>

                    {txn.reference_number && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">
                            {language === 'en' ? 'Reference' : 'Reference'}:
                          </span>
                          <span className="font-mono text-slate-700">
                            {txn.reference_number}
                          </span>
                        </div>
                      </div>
                    )}

                    {txn.related_deal_id && (
                      <div className="mt-2 text-xs">
                        <Link
                          to={createPageUrl('MyDeals')}
                          className="text-blue-600 hover:underline"
                        >
                          {language === 'en' ? 'View Deal' : 'Deal देखें'} →
                        </Link>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}