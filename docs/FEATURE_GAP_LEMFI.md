# LemFi-class features — what we have, what to build, what changes the licence

A gap analysis against the feature set of a mature diaspora remittance app.
The point of this document is the third column: two of these features are
engineering work, and two are a different regulated business.

## The map

| Feature                            | Today                                   | What it costs us                            |
| ---------------------------------- | --------------------------------------- | ------------------------------------------- |
| Sign up, in-app KYC, tiers         | **Built**                               | —                                           |
| Saved recipients, name enquiry     | **Built** (name enquiry is stronger)    | —                                           |
| Live rate, transparent fee         | **Built** (more transparent than LemFi) | —                                           |
| Bank and mobile-money payout       | **Built**, 20 corridors                 | —                                           |
| Transfer history and live status   | **Built**                               | —                                           |
| Status notifications               | Partial — written, email only           | Small                                       |
| Receipt / proof of payment         | Missing                                 | Small, high value                           |
| "Send again" from history          | Missing                                 | Small, high value                           |
| Recipient nicknames and favourites | Partial                                 | Small                                       |
| Scheduled and recurring transfers  | Missing                                 | Medium                                      |
| Rate alerts                        | Missing                                 | Medium                                      |
| Referral programme                 | Missing                                 | Medium, plus an AML wrinkle                 |
| In-app support thread              | Missing                                 | Medium                                      |
| **Multi-currency held balances**   | Missing                                 | **A different licence. See below.**         |
| **Virtual USD cards**              | Missing                                 | **Out of scope — BIN sponsor, card scheme** |
| **Bill payment / airtime top-up**  | Missing                                 | **Conflicts with guardrail 2**              |
| Business / merchant accounts       | Missing                                 | **Forbidden by guardrail 2**                |

## The one that matters: held balances

This is the feature that makes LemFi feel like LemFi — you hold GBP and NGN in
the app and move between them — and it is not an engineering decision.

Today we hold a sender's money only in transit, for one transfer, and release
it when the payout confirms. That is what ADR 0004 settled and it is what the
whole architecture assumes. **A persistent user balance is stored value**, and
storing value is a separate authorisation almost everywhere we operate:
an e-money licence in most European regimes, a Mobile Money Operator or PSSP
authorisation from the CBN in Nigeria, an EMI licence from the Bank of Ghana.
It also brings safeguarding: customer funds segregated in a designated account,
reconciled daily, and unavailable to us as working capital.

The ledger would cope — it is double-entry already, and a user balance is
another account type. The licence would not. So this is a question for the CEO
and counsel, alongside the items already in `OPEN_ITEMS.md`, and not something
to slip in because it is a few days of work. It is a few days of work; that is
exactly what makes it dangerous.

If the answer is eventually yes, the honest sequencing is: get the remittance
licences first, run the pilot, then add stored value as a deliberate second
regulated product.

## The two that are out

**Virtual cards** need a BIN sponsor, card-scheme membership and a PCI scope we
do not have and should not want yet.

**Bill payments and airtime** look harmless and are not: they make us pay
merchants, which is the commercial-payments business guardrail 2 exists to keep
us out of. Sending money to a family member who then buys airtime is our
product. Buying the airtime for them is somebody else's.

## Recommended build order

Everything here is inside our existing licensing posture.

**Tranche A — the things a sender notices immediately.**

1. **Receipt / proof of payment.** A shareable, printable record per completed
   transfer: reference, amounts both sides, rate, fee, recipient name, value
   date. People need this for landlords, schools and their own records, and
   asking support for it is the single most common remittance support ticket.
2. **Send again.** One tap from a completed transfer to a pre-filled new one,
   same recipient and corridor. Most remittance is the same person sending the
   same amount to the same person every month.
3. **Notification channel that reaches people.** The outbox now delivers email;
   status updates should also reach the app. Push where the PWA allows it,
   in-app otherwise.

**Tranche B — retention.**

4. **Scheduled and recurring transfers.** Every occurrence is still a fresh
   quote, a fresh screening and a fresh limit check — a schedule may not
   pre-authorise anything, or it becomes a way around the controls.
5. **Rate alerts.** "Tell me when NGN passes X." Cheap given the rate feed
   already exists, and it is the feature diaspora senders ask for most.
6. **In-app support thread**, distinct from the compliance case queue.

**Tranche C — growth, with a compliance conversation.**

7. **Referral programme.** The wrinkle: incentives create an incentive to
   create accounts, and paying a bonus into a balance we do not have means
   paying it as a fee discount instead. Workable, but the compliance officer
   should see the design before it ships.

## On the interface

The interaction patterns in these apps are industry-standard and there is no
reason not to follow them — a send flow that behaves the way people already
expect is a feature. Our own visual identity stays ours: copying LemFi's
branding would be a trademark problem, and it would also waste the distinct
brand DenghiPay is trying to build.

One thing we should keep rather than copy: we show the mid-market rate, our
rate, and the margin in both money and basis points. Most competitors do not.
That was a deliberate decision (OPEN_ITEMS D1) and it is a differentiator, not
an oversight to be tidied away in a redesign.
