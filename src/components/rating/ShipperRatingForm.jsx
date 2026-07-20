import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Star, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function ShipperRatingForm({ deal, user, onComplete, language = 'hi' }) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [review, setReview] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const queryClient = useQueryClient();

  const createRatingMutation = useMutation({
    mutationFn: async (data) => {
      // Create rating record
      const ratingRecord = await base44.entities.Rating.create(data);
      
      // Update deal to mark shipper as rated
      await base44.entities.Deal.update(deal.id, {
        shipper_rated: true,
        shipper_rating_id: ratingRecord.id
      });
      
      // Fetch shipper's profile to update their average rating
      const shipperProfiles = await base44.entities.UserProfile.filter({ 
        user_email: deal.shipper_email 
      });
      
      if (shipperProfiles.length > 0) {
        const shipperProfile = shipperProfiles[0];
        const newTotalRatings = (shipperProfile.total_ratings || 0) + 1;
        const currentTotal = (shipperProfile.rating_score || 0) * (shipperProfile.total_ratings || 0);
        const newAverage = (currentTotal + data.rating) / newTotalRatings;
        
        await base44.entities.UserProfile.update(shipperProfile.id, {
          rating_score: newAverage,
          total_ratings: newTotalRatings
        });
      }
      
      return ratingRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myDeals'] });
      queryClient.invalidateQueries({ queryKey: ['ratings'] });
      setSubmitted(true);
      toast.success(language === 'en' ? 'Rating submitted successfully!' : 'रेटिंग सफलतापूर्वक जमा की गई!');
      if (onComplete) onComplete();
    },
    onError: (error) => {
      toast.error(language === 'en' ? 'Failed to submit rating' : 'रेटिंग जमा करने में विफल');
      console.error('Rating error:', error);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (rating === 0) {
      toast.error(language === 'en' ? 'Please select a rating' : 'कृपया रेटिंग चुनें');
      return;
    }

    createRatingMutation.mutate({
      deal_id: deal.id,
      rated_by_email: user.email,
      rated_by_name: user.full_name,
      rated_user_email: deal.shipper_email,
      rated_user_name: deal.shipper_name,
      rated_user_type: 'shipper',
      rating: rating,
      review: review,
      deal_route: `${deal.loading_city} → ${deal.unloading_city}`,
      deal_amount: deal.final_price
    });
  };

  const text = {
    en: {
      title: 'Rate Your Experience',
      subtitle: `How was your experience with ${deal.shipper_name || 'this shipper'}?`,
      starPrompt: 'Tap a star to rate',
      reviewLabel: 'Share your experience (optional)',
      reviewPlaceholder: 'Tell us about your experience...',
      submitButton: 'Submit Rating',
      thankYou: 'Thank you for your feedback!',
      yourRating: 'Your rating helps other truck owners make informed decisions.'
    },
    hi: {
      title: 'अपना अनुभव रेट करें',
      subtitle: `${deal.shipper_name || 'इस शिपर'} के साथ आपका अनुभव कैसा रहा?`,
      starPrompt: 'रेटिंग देने के लिए स्टार पर टैप करें',
      reviewLabel: 'अपना अनुभव साझा करें (वैकल्पिक)',
      reviewPlaceholder: 'हमें अपने अनुभव के बारे में बताएं...',
      submitButton: 'रेटिंग जमा करें',
      thankYou: 'आपकी प्रतिक्रिया के लिए धन्यवाद!',
      yourRating: 'आपकी रेटिंग अन्य ट्रक मालिकों को सूचित निर्णय लेने में मदद करती है।'
    }
  };

  const t = text[language];

  if (submitted) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="py-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-green-900 mb-2">{t.thankYou}</h3>
          <p className="text-sm text-green-700">{t.yourRating}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t.title}</CardTitle>
        <p className="text-sm text-slate-600">{t.subtitle}</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Star Rating */}
          <div className="text-center">
            <p className="text-sm text-slate-600 mb-3">{t.starPrompt}</p>
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoveredRating(star)}
                  onMouseLeave={() => setHoveredRating(0)}
                  className="transition-transform hover:scale-110"
                >
                  <Star
                    className={`h-10 w-10 ${
                      star <= (hoveredRating || rating)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-slate-300'
                    }`}
                  />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <p className="text-sm text-slate-600 mt-2">
                {rating === 1 && (language === 'en' ? 'Poor' : 'खराब')}
                {rating === 2 && (language === 'en' ? 'Fair' : 'ठीक')}
                {rating === 3 && (language === 'en' ? 'Good' : 'अच्छा')}
                {rating === 4 && (language === 'en' ? 'Very Good' : 'बहुत अच्छा')}
                {rating === 5 && (language === 'en' ? 'Excellent' : 'उत्कृष्ट')}
              </p>
            )}
          </div>

          {/* Review Text */}
          <div>
            <label className="block text-sm font-medium mb-2">{t.reviewLabel}</label>
            <Textarea
              value={review}
              onChange={(e) => setReview(e.target.value)}
              placeholder={t.reviewPlaceholder}
              rows={4}
              className="resize-none"
            />
          </div>

          {/* Submit Button */}
          <Button 
            type="submit" 
            className="w-full bg-orange-500 hover:bg-orange-600"
            disabled={createRatingMutation.isPending || rating === 0}
          >
            {createRatingMutation.isPending 
              ? (language === 'en' ? 'Submitting...' : 'जमा हो रहा है...')
              : t.submitButton
            }
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}