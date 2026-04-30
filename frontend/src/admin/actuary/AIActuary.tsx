import RiskMonitor from './RiskMonitor';
import ExternalIntelligence from './ExternalIntelligence';
import PricingOptimiser from './PricingOptimiser';

export default function AIActuary() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-bebas text-4xl tracking-widest text-[#f0f0f0]">AI ACTUARY</h1>
        <p className="text-[#666666] text-sm mt-1 leading-relaxed">
          Decision-support system for pricing, risk monitoring, and external intelligence.
          All pricing changes require explicit approval.
        </p>
      </div>

      <RiskMonitor />
      <ExternalIntelligence />
      <PricingOptimiser />
    </div>
  );
}
