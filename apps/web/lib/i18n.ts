/**
 * Translation tables (BUILD_PLAN 10.6).
 *
 * Russian, English and French from day one, and no user-facing string is
 * hardcoded in a component. The structure is a flat key space rather than
 * nested objects, so adding Hausa, Yoruba, Igbo or Twi later is a new file
 * with the same keys — not a refactor.
 *
 * Transfer status keys mirror `SENDER_FACING_STATUS` from the domain package,
 * so renaming an internal state never changes what a sender reads.
 */

export const LOCALES = ['ru', 'en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = {
  ru: 'Русский',
  en: 'English',
  fr: 'Français',
};

const en = {
  'app.name': 'MoraPay',
  'app.tagline': 'Send money home, honestly priced.',

  'nav.home': 'Home',
  'nav.send': 'Send',
  'nav.transfers': 'Transfers',
  'nav.settings': 'Settings',

  'action.continue': 'Continue',
  'action.back': 'Back',
  'action.cancel': 'Cancel',
  'action.confirm': 'Confirm',
  'action.retry': 'Try again',
  'action.signIn': 'Sign in',
  'action.signOut': 'Sign out',
  'action.signUp': 'Create account',
  'action.sendMoney': 'Send money',
  'action.addRecipient': 'Add a recipient',
  'action.done': 'Done',
  'action.copy': 'Copy',
  'action.copied': 'Copied',

  'auth.signIn.title': 'Sign in',
  'auth.signUp.title': 'Create your account',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.passwordHint': 'At least 12 characters.',
  'auth.terms': 'I accept the terms and the privacy notice',
  'auth.noAccount': 'No account yet?',
  'auth.haveAccount': 'Already have an account?',
  'auth.verify.title': 'Confirm your email',
  'auth.verify.body':
    'We sent a confirmation link to your email. You can look around, but sending money needs a confirmed address.',
  'auth.verify.resend': 'Send it again',
  'auth.verify.resending': 'Sending…',
  'auth.verify.resent': 'Sent. Check your inbox, and your spam folder.',
  'auth.verify.openLink': 'Open my confirmation link',
  'auth.verify.bodyNoMail': 'Your account is created. Confirm this address to start sending money.',
  'auth.verify.noMailServer':
    'This demonstration has no mail server, so the link is shown here instead of emailed. It is yours alone — nobody else can see it.',
  'auth.verify.success': 'Your email is confirmed. You can send money now.',

  'home.greeting': 'Send money',
  'home.recent': 'Recent transfers',
  'home.empty': 'No transfers yet. Your first one takes about a minute.',
  'home.corridors': 'Where you can send',

  'send.step.amount': 'Amount',
  'send.step.recipient': 'Recipient',
  'send.step.review': 'Review',
  'send.step.pay': 'Pay',

  'send.amount.title': 'How much are you sending?',
  'send.amount.youSend': 'You send',
  'send.amount.theyReceive': 'They receive',
  'send.amount.corridor': 'Destination',
  'send.amount.quoteExpires': 'This rate holds for {seconds}s',
  'send.amount.refreshQuote': 'Refresh the rate',
  'send.amount.expired': 'The rate expired. Refresh to see the current one.',

  'send.breakdown.title': 'What this costs',
  'send.breakdown.sendAmount': 'Amount to convert',
  'send.breakdown.fixedFee': 'Our fee',
  'send.breakdown.fxMargin': 'Exchange-rate margin',
  'send.breakdown.totalCost': 'Total you pay us',
  'send.breakdown.totalToPay': 'Total to pay',
  'send.breakdown.midRate': 'Mid-market rate',
  'send.breakdown.ourRate': 'Your rate',
  'send.breakdown.atMid': 'At the mid-market rate they would receive',
  'send.breakdown.explain':
    'We show the mid-market rate and our margin separately. Nothing is hidden inside the rate.',

  'send.recipient.title': 'Who is receiving it?',
  'send.recipient.saved': 'Saved recipients',
  'send.recipient.new': 'Someone new',
  'send.recipient.country': 'Country',
  'send.recipient.bank': 'Bank',
  'send.recipient.network': 'Mobile money network',
  'send.recipient.accountNumber': 'Account number',
  'send.recipient.msisdn': 'Mobile number',
  'send.recipient.name': 'Their name',
  'send.recipient.nickname': 'Nickname (optional)',
  'send.recipient.check': 'Check the account',
  'send.recipient.checking': 'Checking with the bank…',
  'send.recipient.resolved': 'The bank holds this account in the name of',
  'send.recipient.resolvedMomo': 'The network holds this number in the name of',
  'send.recipient.confirmName': 'Yes, that is the right person',
  'send.recipient.nameMismatch':
    'That is not the name you typed. Check the number before you continue — money sent to the wrong account cannot be recovered.',
  'send.recipient.notFound':
    'No account matches that number. Check the digits and the institution.',

  'send.review.title': 'Check and confirm',
  'send.review.purpose': 'Reason for sending',
  'send.review.payWith': 'Pay with',
  'send.review.commit': 'Confirm and pay',
  'send.review.personalOnly':
    'MoraPay carries personal transfers only — family support, education, medical costs and gifts.',

  /* Exchange control. Shown only where the origin has a regime — today South
     Africa. The caveat on the remaining figure is not decoration: an allowance
     is personal and spans every provider, so our number is a ceiling on what we
     know about, never on what the sender has actually used. */
  'send.declaration.title': 'Exchange control declaration',
  'send.declaration.intro':
    'Money leaving {country} must be declared under a published reason code. {authority} sets the rules and {reportedBy} files the declaration.',
  'send.declaration.category': 'Reason code',
  'send.declaration.categoryPlaceholder': 'Choose the reason that fits',
  'send.declaration.allowance': 'Your {year} allowance',
  'send.declaration.remaining': 'Remaining',
  'send.declaration.usedThroughUs': 'Used through MoraPay',
  'send.declaration.usedElsewhere': 'Already used with other providers this year',
  'send.declaration.usedElsewhereHint':
    'Leave at 0 if you have sent nothing abroad through anyone else this year.',
  'send.declaration.caveat':
    'We can only see what you have sent through us. The allowance is yours personally and covers every provider you use, so the figure above is what we know about — not proof of what is left. Declaring the rest keeps the count right.',
  'send.declaration.affirm': 'I confirm this declaration is true and complete.',
  'send.declaration.affirmRequired': 'Confirm the declaration to continue.',
  'send.declaration.categoryRequired': 'Choose a reason code to continue.',

  'send.pay.title': 'Complete your payment',
  'send.pay.sbp': 'Open your bank app to approve the payment.',
  'send.pay.qr': 'Scan this code in your bank app.',
  'send.pay.account': 'Transfer to this account, using the reference exactly as shown.',
  'send.pay.reference': 'Reference',
  'send.pay.openBank': 'Open my bank app',
  'send.pay.simulate': 'Simulate the payment (demo)',
  'send.pay.waiting': 'Waiting for your payment…',
  'send.pay.momo': 'Check your phone. Approve the payment request with your mobile money PIN.',
  'send.pay.momoWallet': 'Wallet',
  'send.pay.momoFallback': 'No prompt? Dial this and choose “Approve payment”.',

  'purpose.FAMILY_SUPPORT': 'Family support',
  'purpose.EDUCATION': 'Education',
  'purpose.MEDICAL': 'Medical',
  'purpose.GIFT': 'Gift',
  'purpose.OWN_ACCOUNT': 'My own account',

  'payin.SBP': 'Instant bank transfer (SBP)',
  'payin.QR': 'QR code',
  'payin.CARD': 'Card',
  'payin.VIRTUAL_ACCOUNT': 'Bank transfer',
  'payin.MOBILE_MONEY': 'Mobile money',

  'status.draft': 'Draft',
  'status.awaiting_confirmation': 'Awaiting your confirmation',
  'status.checking': 'Running our checks',
  'status.under_review': 'Under review',
  'status.awaiting_your_payment': 'Waiting for your payment',
  'status.payment_received': 'Payment received',
  'status.converting': 'Converting',
  'status.sending_to_recipient': 'Sending to your recipient',
  'status.delivered': 'Delivered',
  'status.completed': 'Completed',
  'status.refund_in_progress': 'Refunding',
  'status.refunded': 'Refunded',
  'status.failed': 'Could not be completed',

  'status.help.under_review':
    'Every transfer is checked against sanctions lists. Ours flagged something, and a person is looking at it. We will email you.',
  'status.help.refunded':
    'Your money is on its way back, including our fee. We do not keep a fee for a transfer we did not deliver.',

  'transfer.reference': 'Reference',
  'transfer.timeline': 'Progress',
  'transfer.recipient': 'Recipient',
  'transfer.sent': 'Sent',
  'transfer.received': 'Received',
  'transfer.track': 'Track',

  'kyc.title': 'Verify your identity',
  'kyc.tier': 'Tier {tier}',
  'kyc.current': 'You are at tier {tier}.',
  'kyc.limitNote': 'Tier {tier} lets you send up to {limit} per transfer.',
  'kyc.required': 'Documents we need',
  'kyc.alternatives': 'Any one of these also works',
  'kyc.submit': 'Submit for verification',
  'kyc.submitted': 'Submitted. Most checks finish in a few minutes.',
  'kyc.tier0Block':
    'Your account is not verified yet, so you cannot send money. Verification takes a few minutes.',
  'kyc.upgradePrompt': 'That amount needs tier {tier}. Verify now to send it.',
  'kyc.firstName': 'First name',
  'kyc.lastName': 'Last name',
  'kyc.dateOfBirth': 'Date of birth',
  'kyc.nationality': 'Nationality',
  'kyc.documents': 'Documents',
  'kyc.upload': 'Attach',
  'kyc.attached': 'Attached',
  /* Jurisdiction-specific identity anchors, shown only to the residency that
     uses them. Each unlocks a later step: BVN matching in Nigeria, a named
     wallet to debit in Ghana, and an exchange-control declaration in South
     Africa that cannot be decided without an identity number and a status. */
  'kyc.identity': 'Identity in {country}',
  'kyc.bvn': 'Bank Verification Number',
  'kyc.bvnHint': 'Eleven digits. Dial *565*0# if you do not have it to hand.',
  'kyc.ghanaCard': 'Ghana Card number',
  'kyc.ghanaCardHint': 'GHA-123456789-0',
  'kyc.wallet': 'Mobile money wallet we will debit',
  'kyc.walletHint': 'It must be registered in the name you gave above.',
  'kyc.walletNetwork': 'Network',
  'kyc.nationalId': 'National identity number',
  'kyc.taxReference': 'SARS tax reference (optional)',
  'kyc.taxReferenceHint':
    'Only needed for the investment allowance. The discretionary allowance does not ask for it.',
  'kyc.exchangeControlStatus': 'Exchange control status',
  'kyc.exchangeControlHint':
    'Residents, temporary residents and non-residents have different allowances. Only residents can send today.',
  'kyc.status.RESIDENT': 'Resident',
  'kyc.status.TEMPORARY_RESIDENT': 'Temporary resident',
  'kyc.status.NON_RESIDENT': 'Non-resident',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.account': 'Account',
  'settings.verification': 'Identity verification',
  'settings.manage': 'Manage',
  'settings.install': 'Install the app',
  'settings.installHint': 'Add MoraPay to your home screen. It works on a weak connection.',

  'error.offline': 'You are offline. We saved where you were — try again when you have a signal.',
  'error.generic': 'Something went wrong. Please try again.',
  'error.QUOTE_EXPIRED': 'That rate expired. Get a fresh one.',
  'error.LIMIT_EXCEEDED': 'That is above your limit.',
  'error.EMAIL_NOT_VERIFIED': 'Confirm your email address first.',
  'error.RECIPIENT_NAME_MISMATCH': 'The name does not match the account.',
  'error.INVALID_CREDENTIALS': 'Email or password is incorrect.',
  'error.RATE_UNAVAILABLE':
    'We cannot price this right now — our rate feed is stale and we will not guess. Try again shortly.',
  'error.EXCHANGE_CONTROL_ALLOWANCE_EXCEEDED':
    'This would take you past your annual allowance, counting what you told us you used elsewhere. Send a smaller amount, or speak to your bank about the investment allowance.',
  'error.EXCHANGE_CONTROL_CATEGORY_REQUIRED': 'Choose a reason code before sending.',
  'error.EXCHANGE_CONTROL_CATEGORY_UNKNOWN':
    'That reason code is not one we can declare. Choose another.',
  'error.EXCHANGE_CONTROL_TAX_CLEARANCE_REQUIRED':
    'This reason needs a tax clearance reference on file. Add it in your verification details first.',
  'error.EXCHANGE_CONTROL_UNDER_AGE':
    'This allowance is available from adulthood, and the date of birth we hold does not reach it.',
  'error.EXCHANGE_CONTROL_SUBJECT_MISSING':
    'We do not hold the verified details this declaration needs. Complete verification first.',
  'error.EXCHANGE_CONTROL_STATUS_UNSUPPORTED':
    'Only residents can send on this route today. Temporary and non-residents follow different rules that we have not built yet.',

  /* Product surface (BUILD_PLAN 14): notifications, receipts, standing
     instructions, rate alerts and support. */
  'notifications.title': 'Notifications',
  'notifications.empty': 'Nothing yet. Updates about your transfers appear here.',
  'notifications.markAll': 'Mark all read',
  'notifications.unread': 'Unread',

  'receipt.title': 'Receipt',
  'receipt.subtitle': 'Proof of payment',
  'receipt.print': 'Print or save as PDF',
  'receipt.reference': 'Reference',
  'receipt.valueDate': 'Sent',
  'receipt.completedAt': 'Delivered',
  'receipt.sender': 'Sender',
  'receipt.from': 'Sent from',
  'receipt.recipient': 'Recipient',
  'receipt.account': 'Account',
  'receipt.regime': 'Reported under',
  'receipt.issued': 'Issued {at}. MoraPay — demonstration environment.',
  'receipt.view': 'Receipt',

  'schedules.title': 'Standing instructions',
  'schedules.explain':
    'A standing instruction prepares your transfer on the day you choose and tells you it is ready. It never takes money by itself — you always approve the payment.',
  'schedules.yours': 'Your instructions',
  'schedules.new': 'New instruction',
  'schedules.to': 'to',
  'schedules.next': 'Next',
  'schedules.prepared': 'prepared {count} times',
  'schedules.lastFailed': 'The last one could not be prepared',
  'schedules.active': 'Active',
  'schedules.paused': 'Paused',
  'schedules.pause': 'Pause',
  'schedules.resume': 'Resume',
  'schedules.frequency': 'How often',
  'schedules.monthly': 'Every month',
  'schedules.weekly': 'Every week',
  'schedules.monthlyOn': 'monthly on the {day}',
  'schedules.weeklyOn': 'weekly, day {day}',
  'schedules.dayOfMonth': 'Day of the month',
  'schedules.dayOfWeek': 'Day of the week',
  'schedules.dayCap': 'Up to the 28th, so the instruction never skips a month that is too short.',
  'schedules.chooseRecipient': 'Choose a saved recipient',
  'schedules.create': 'Create instruction',

  'weekday.1': 'Monday',
  'weekday.2': 'Tuesday',
  'weekday.3': 'Wednesday',
  'weekday.4': 'Thursday',
  'weekday.5': 'Friday',
  'weekday.6': 'Saturday',
  'weekday.7': 'Sunday',

  'alerts.title': 'Rate alerts',
  'alerts.explain':
    'We will tell you when a rate reaches your number. The rate we watch is the one you would be quoted, margin included — not the mid-market rate.',
  'alerts.yours': 'Your alerts',
  'alerts.new': 'New alert',
  'alerts.when': 'Tell me when the rate is',
  'alerts.above': 'at or above',
  'alerts.below': 'at or below',
  'alerts.threshold': 'Rate',
  'alerts.thresholdHint': '{to} per 1 {from}',
  'alerts.create': 'Watch this rate',
  'alerts.remove': 'Remove',
  'alerts.watching': 'Watching',
  'alerts.fired': 'Sent',
  'alerts.currently': 'Currently {rate}',
  'alerts.rateUnavailable': 'Rate unavailable right now',
  'alerts.firedAt': 'Reached {rate} on {at}',
  'alerts.notHeld': 'An alert is not a held rate. When it arrives, open the app for a live quote.',

  'support.title': 'Help',
  'support.new': 'Ask us something',
  'support.subject': 'Subject',
  'support.message': 'What is happening?',
  'support.noSecrets': 'Never include your password or a one-time code.',
  'support.open': 'Send to support',
  'support.reply': 'Reply',
  'support.send': 'Send reply',
  'support.you': 'You',
  'support.status.OPEN': 'Waiting for us',
  'support.status.ANSWERED': 'Replied',
  'support.status.RESOLVED': 'Resolved',

  'transfer.sendAgain': 'Send again',

  'demo.banner': 'Demonstration environment — no real money moves.',
} as const;

export type TranslationKey = keyof typeof en;

const ru: Record<TranslationKey, string> = {
  'app.name': 'MoraPay',
  'app.tagline': 'Переводы домой с честной ценой.',

  'nav.home': 'Главная',
  'nav.send': 'Отправить',
  'nav.transfers': 'Переводы',
  'nav.settings': 'Настройки',

  'action.continue': 'Продолжить',
  'action.back': 'Назад',
  'action.cancel': 'Отменить',
  'action.confirm': 'Подтвердить',
  'action.retry': 'Повторить',
  'action.signIn': 'Войти',
  'action.signOut': 'Выйти',
  'action.signUp': 'Создать аккаунт',
  'action.sendMoney': 'Отправить деньги',
  'action.addRecipient': 'Добавить получателя',
  'action.done': 'Готово',
  'action.copy': 'Копировать',
  'action.copied': 'Скопировано',

  'auth.signIn.title': 'Вход',
  'auth.signUp.title': 'Создание аккаунта',
  'auth.email': 'Электронная почта',
  'auth.password': 'Пароль',
  'auth.passwordHint': 'Не менее 12 символов.',
  'auth.terms': 'Я принимаю условия и политику конфиденциальности',
  'auth.noAccount': 'Ещё нет аккаунта?',
  'auth.haveAccount': 'Уже есть аккаунт?',
  'auth.verify.title': 'Подтвердите почту',
  'auth.verify.body':
    'Мы отправили ссылку для подтверждения. Осмотреться можно и так, но для переводов почта должна быть подтверждена.',
  'auth.verify.resend': 'Отправить ещё раз',
  'auth.verify.resending': 'Отправляем…',
  'auth.verify.resent': 'Отправлено. Проверьте почту и папку «Спам».',
  'auth.verify.openLink': 'Открыть мою ссылку подтверждения',
  'auth.verify.bodyNoMail': 'Аккаунт создан. Подтвердите адрес, чтобы отправлять деньги.',
  'auth.verify.noMailServer':
    'В этой демоверсии нет почтового сервера, поэтому ссылка показана здесь, а не отправлена письмом. Она только ваша — никто другой её не видит.',
  'auth.verify.success': 'Почта подтверждена. Теперь можно отправлять деньги.',

  'home.greeting': 'Отправить деньги',
  'home.recent': 'Последние переводы',
  'home.empty': 'Переводов пока нет. Первый занимает около минуты.',
  'home.corridors': 'Куда можно отправить',

  'send.step.amount': 'Сумма',
  'send.step.recipient': 'Получатель',
  'send.step.review': 'Проверка',
  'send.step.pay': 'Оплата',

  'send.amount.title': 'Сколько отправляете?',
  'send.amount.youSend': 'Вы отправляете',
  'send.amount.theyReceive': 'Получатель получит',
  'send.amount.corridor': 'Куда',
  'send.amount.quoteExpires': 'Курс действует {seconds} с',
  'send.amount.refreshQuote': 'Обновить курс',
  'send.amount.expired': 'Курс истёк. Обновите, чтобы увидеть текущий.',

  'send.breakdown.title': 'Из чего складывается цена',
  'send.breakdown.sendAmount': 'Сумма к обмену',
  'send.breakdown.fixedFee': 'Наша комиссия',
  'send.breakdown.fxMargin': 'Наценка к курсу',
  'send.breakdown.totalCost': 'Всего вы платите нам',
  'send.breakdown.totalToPay': 'Итого к оплате',
  'send.breakdown.midRate': 'Межбанковский курс',
  'send.breakdown.ourRate': 'Ваш курс',
  'send.breakdown.atMid': 'По межбанковскому курсу получатель получил бы',
  'send.breakdown.explain':
    'Мы показываем межбанковский курс и нашу наценку отдельно. Внутри курса ничего не спрятано.',

  'send.recipient.title': 'Кто получает?',
  'send.recipient.saved': 'Сохранённые получатели',
  'send.recipient.new': 'Новый получатель',
  'send.recipient.country': 'Страна',
  'send.recipient.bank': 'Банк',
  'send.recipient.network': 'Оператор мобильных денег',
  'send.recipient.accountNumber': 'Номер счёта',
  'send.recipient.msisdn': 'Номер телефона',
  'send.recipient.name': 'Имя получателя',
  'send.recipient.nickname': 'Название (необязательно)',
  'send.recipient.check': 'Проверить счёт',
  'send.recipient.checking': 'Проверяем в банке…',
  'send.recipient.resolved': 'Банк указывает владельцем счёта',
  'send.recipient.resolvedMomo': 'Оператор указывает владельцем номера',
  'send.recipient.confirmName': 'Да, это нужный человек',
  'send.recipient.nameMismatch':
    'Это не то имя, которое вы ввели. Проверьте номер: деньги, отправленные не туда, вернуть нельзя.',
  'send.recipient.notFound': 'Счёт с таким номером не найден. Проверьте цифры и учреждение.',

  'send.review.title': 'Проверьте и подтвердите',
  'send.review.purpose': 'Причина перевода',
  'send.review.payWith': 'Способ оплаты',
  'send.review.commit': 'Подтвердить и оплатить',
  'send.review.personalOnly':
    'MoraPay выполняет только личные переводы — поддержка семьи, обучение, лечение и подарки.',

  'send.declaration.title': 'Декларация валютного контроля',
  'send.declaration.intro':
    'Средства, покидающие {country}, декларируются по официальному коду цели. Правила устанавливает {authority}, а декларацию подаёт {reportedBy}.',
  'send.declaration.category': 'Код цели',
  'send.declaration.categoryPlaceholder': 'Выберите подходящую цель',
  'send.declaration.allowance': 'Ваш лимит на {year} год',
  'send.declaration.remaining': 'Остаток',
  'send.declaration.usedThroughUs': 'Использовано через MoraPay',
  'send.declaration.usedElsewhere': 'Уже использовано у других провайдеров в этом году',
  'send.declaration.usedElsewhereHint':
    'Оставьте 0, если в этом году вы не отправляли за рубеж ни через кого другого.',
  'send.declaration.caveat':
    'Мы видим только то, что вы отправили через нас. Лимит принадлежит вам лично и охватывает всех провайдеров, поэтому цифра выше отражает лишь известное нам, а не подтверждённый остаток. Укажите остальное, чтобы счёт был верным.',
  'send.declaration.affirm': 'Подтверждаю, что декларация верна и полна.',
  'send.declaration.affirmRequired': 'Подтвердите декларацию, чтобы продолжить.',
  'send.declaration.categoryRequired': 'Выберите код цели, чтобы продолжить.',

  'send.pay.title': 'Завершите оплату',
  'send.pay.sbp': 'Откройте приложение банка и подтвердите платёж.',
  'send.pay.qr': 'Отсканируйте код в приложении банка.',
  'send.pay.account': 'Переведите на этот счёт, указав назначение точно как показано.',
  'send.pay.reference': 'Назначение',
  'send.pay.openBank': 'Открыть приложение банка',
  'send.pay.simulate': 'Смоделировать оплату (демо)',
  'send.pay.waiting': 'Ждём вашу оплату…',
  'send.pay.momo': 'Проверьте телефон. Подтвердите запрос PIN-кодом мобильного кошелька.',
  'send.pay.momoWallet': 'Кошелёк',
  'send.pay.momoFallback': 'Запрос не пришёл? Наберите этот код и выберите «Подтвердить платёж».',

  'purpose.FAMILY_SUPPORT': 'Поддержка семьи',
  'purpose.EDUCATION': 'Обучение',
  'purpose.MEDICAL': 'Лечение',
  'purpose.GIFT': 'Подарок',
  'purpose.OWN_ACCOUNT': 'Свой счёт',

  'payin.SBP': 'Мгновенный перевод (СБП)',
  'payin.QR': 'QR-код',
  'payin.CARD': 'Карта',
  'payin.VIRTUAL_ACCOUNT': 'Банковский перевод',
  'payin.MOBILE_MONEY': 'Мобильный кошелёк',

  'status.draft': 'Черновик',
  'status.awaiting_confirmation': 'Ждёт подтверждения',
  'status.checking': 'Идут проверки',
  'status.under_review': 'На рассмотрении',
  'status.awaiting_your_payment': 'Ждём вашу оплату',
  'status.payment_received': 'Оплата получена',
  'status.converting': 'Конвертируем',
  'status.sending_to_recipient': 'Отправляем получателю',
  'status.delivered': 'Доставлено',
  'status.completed': 'Завершено',
  'status.refund_in_progress': 'Возвращаем',
  'status.refunded': 'Возвращено',
  'status.failed': 'Не удалось выполнить',

  'status.help.under_review':
    'Каждый перевод проверяется по санкционным спискам. Наша проверка что-то отметила, и сейчас её смотрит сотрудник. Мы напишем вам.',
  'status.help.refunded':
    'Деньги возвращаются вам вместе с комиссией. Мы не оставляем комиссию за перевод, который не выполнили.',

  'transfer.reference': 'Номер',
  'transfer.timeline': 'Ход выполнения',
  'transfer.recipient': 'Получатель',
  'transfer.sent': 'Отправлено',
  'transfer.received': 'Получено',
  'transfer.track': 'Отследить',

  'kyc.title': 'Подтвердите личность',
  'kyc.tier': 'Уровень {tier}',
  'kyc.current': 'У вас уровень {tier}.',
  'kyc.limitNote': 'Уровень {tier} позволяет отправлять до {limit} за перевод.',
  'kyc.required': 'Нужные документы',
  'kyc.alternatives': 'Подойдёт любой из этих',
  'kyc.submit': 'Отправить на проверку',
  'kyc.submitted': 'Отправлено. Обычно проверка занимает несколько минут.',
  'kyc.tier0Block':
    'Личность ещё не подтверждена, поэтому отправлять деньги нельзя. Проверка занимает несколько минут.',
  'kyc.upgradePrompt':
    'Для этой суммы нужен уровень {tier}. Подтвердите личность, чтобы отправить.',
  'kyc.firstName': 'Имя',
  'kyc.lastName': 'Фамилия',
  'kyc.dateOfBirth': 'Дата рождения',
  'kyc.nationality': 'Гражданство',
  'kyc.documents': 'Документы',
  'kyc.upload': 'Прикрепить',
  'kyc.attached': 'Прикреплено',
  'kyc.identity': 'Личность в стране {country}',
  'kyc.bvn': 'Банковский идентификационный номер (BVN)',
  'kyc.bvnHint': 'Одиннадцать цифр. Если не помните — наберите *565*0#.',
  'kyc.ghanaCard': 'Номер Ghana Card',
  'kyc.ghanaCardHint': 'GHA-123456789-0',
  'kyc.wallet': 'Кошелёк мобильных денег для списания',
  'kyc.walletHint': 'Он должен быть зарегистрирован на указанное выше имя.',
  'kyc.walletNetwork': 'Оператор',
  'kyc.nationalId': 'Национальный идентификационный номер',
  'kyc.taxReference': 'Налоговый номер SARS (необязательно)',
  'kyc.taxReferenceHint':
    'Нужен только для инвестиционного лимита. Для дискреционного он не требуется.',
  'kyc.exchangeControlStatus': 'Статус валютного контроля',
  'kyc.exchangeControlHint':
    'У резидентов, временных резидентов и нерезидентов разные лимиты. Сегодня отправлять могут только резиденты.',
  'kyc.status.RESIDENT': 'Резидент',
  'kyc.status.TEMPORARY_RESIDENT': 'Временный резидент',
  'kyc.status.NON_RESIDENT': 'Нерезидент',

  'settings.title': 'Настройки',
  'settings.language': 'Язык',
  'settings.account': 'Аккаунт',
  'settings.verification': 'Подтверждение личности',
  'settings.manage': 'Управление',
  'settings.install': 'Установить приложение',
  'settings.installHint': 'Добавьте MoraPay на главный экран. Работает и на слабой связи.',

  'error.offline': 'Нет соединения. Мы сохранили ваш шаг — повторите, когда появится сеть.',
  'error.generic': 'Что-то пошло не так. Попробуйте ещё раз.',
  'error.QUOTE_EXPIRED': 'Курс истёк. Получите новый.',
  'error.LIMIT_EXCEEDED': 'Сумма превышает ваш лимит.',
  'error.EMAIL_NOT_VERIFIED': 'Сначала подтвердите электронную почту.',
  'error.RECIPIENT_NAME_MISMATCH': 'Имя не совпадает со счётом.',
  'error.INVALID_CREDENTIALS': 'Неверная почта или пароль.',
  'error.RATE_UNAVAILABLE':
    'Сейчас не можем назвать цену — курс устарел, а гадать мы не будем. Попробуйте чуть позже.',
  'error.EXCHANGE_CONTROL_ALLOWANCE_EXCEEDED':
    'С учётом того, что вы указали как использованное у других провайдеров, перевод выйдет за годовой лимит. Отправьте меньшую сумму или обсудите с банком инвестиционный лимит.',
  'error.EXCHANGE_CONTROL_CATEGORY_REQUIRED': 'Выберите код цели перед отправкой.',
  'error.EXCHANGE_CONTROL_CATEGORY_UNKNOWN':
    'Такой код цели мы задекларировать не можем. Выберите другой.',
  'error.EXCHANGE_CONTROL_TAX_CLEARANCE_REQUIRED':
    'Для этой цели нужен налоговый номер в вашем профиле. Сначала добавьте его при верификации.',
  'error.EXCHANGE_CONTROL_UNDER_AGE':
    'Этот лимит доступен с совершеннолетия, а по имеющейся у нас дате рождения оно ещё не наступило.',
  'error.EXCHANGE_CONTROL_SUBJECT_MISSING':
    'У нас нет проверенных данных, которых требует эта декларация. Сначала пройдите верификацию.',
  'error.EXCHANGE_CONTROL_STATUS_UNSUPPORTED':
    'Сегодня по этому направлению отправлять могут только резиденты. Для временных и нерезидентов действуют другие правила, которые мы ещё не реализовали.',

  'notifications.title': 'Уведомления',
  'notifications.empty': 'Пока пусто. Здесь появятся новости о ваших переводах.',
  'notifications.markAll': 'Отметить всё прочитанным',
  'notifications.unread': 'Не прочитано',

  'receipt.title': 'Квитанция',
  'receipt.subtitle': 'Подтверждение платежа',
  'receipt.print': 'Печать или сохранить в PDF',
  'receipt.reference': 'Номер',
  'receipt.valueDate': 'Отправлено',
  'receipt.completedAt': 'Доставлено',
  'receipt.sender': 'Отправитель',
  'receipt.from': 'Откуда',
  'receipt.recipient': 'Получатель',
  'receipt.account': 'Счёт',
  'receipt.regime': 'Отчётность',
  'receipt.issued': 'Выдано {at}. MoraPay — демонстрационная среда.',
  'receipt.view': 'Квитанция',

  'schedules.title': 'Регулярные переводы',
  'schedules.explain':
    'Регулярный перевод готовится в выбранный вами день, и мы сообщаем, что он готов. Деньги никогда не списываются сами — оплату вы подтверждаете всегда.',
  'schedules.yours': 'Ваши поручения',
  'schedules.new': 'Новое поручение',
  'schedules.to': 'для',
  'schedules.next': 'Следующий',
  'schedules.prepared': 'подготовлен раз: {count}',
  'schedules.lastFailed': 'Последний подготовить не удалось',
  'schedules.active': 'Активно',
  'schedules.paused': 'Приостановлено',
  'schedules.pause': 'Приостановить',
  'schedules.resume': 'Возобновить',
  'schedules.frequency': 'Как часто',
  'schedules.monthly': 'Каждый месяц',
  'schedules.weekly': 'Каждую неделю',
  'schedules.monthlyOn': 'ежемесячно, {day}-го',
  'schedules.weeklyOn': 'еженедельно, день {day}',
  'schedules.dayOfMonth': 'День месяца',
  'schedules.dayOfWeek': 'День недели',
  'schedules.dayCap': 'До 28-го, чтобы поручение не пропускало короткие месяцы.',
  'schedules.chooseRecipient': 'Выберите сохранённого получателя',
  'schedules.create': 'Создать поручение',

  'weekday.1': 'Понедельник',
  'weekday.2': 'Вторник',
  'weekday.3': 'Среда',
  'weekday.4': 'Четверг',
  'weekday.5': 'Пятница',
  'weekday.6': 'Суббота',
  'weekday.7': 'Воскресенье',

  'alerts.title': 'Оповещения о курсе',
  'alerts.explain':
    'Сообщим, когда курс достигнет вашего значения. Мы следим за тем курсом, который вам предложат, — с учётом нашей наценки, а не за среднерыночным.',
  'alerts.yours': 'Ваши оповещения',
  'alerts.new': 'Новое оповещение',
  'alerts.when': 'Сообщить, когда курс',
  'alerts.above': 'не ниже',
  'alerts.below': 'не выше',
  'alerts.threshold': 'Курс',
  'alerts.thresholdHint': '{to} за 1 {from}',
  'alerts.create': 'Следить за курсом',
  'alerts.remove': 'Удалить',
  'alerts.watching': 'Следим',
  'alerts.fired': 'Отправлено',
  'alerts.currently': 'Сейчас {rate}',
  'alerts.rateUnavailable': 'Курс сейчас недоступен',
  'alerts.firedAt': 'Достигнут {rate} — {at}',
  'alerts.notHeld':
    'Оповещение не фиксирует курс. Когда оно придёт, откройте приложение и получите актуальную котировку.',

  'support.title': 'Помощь',
  'support.new': 'Задать вопрос',
  'support.subject': 'Тема',
  'support.message': 'Что произошло?',
  'support.noSecrets': 'Никогда не указывайте пароль или одноразовый код.',
  'support.open': 'Отправить в поддержку',
  'support.reply': 'Ответ',
  'support.send': 'Отправить ответ',
  'support.you': 'Вы',
  'support.status.OPEN': 'Ждёт нас',
  'support.status.ANSWERED': 'Отвечено',
  'support.status.RESOLVED': 'Решено',

  'transfer.sendAgain': 'Отправить снова',

  'demo.banner': 'Демонстрационная среда — реальные деньги не двигаются.',
};

const fr: Record<TranslationKey, string> = {
  'app.name': 'MoraPay',
  'app.tagline': 'Envoyez de l’argent chez vous, à un prix honnête.',

  'nav.home': 'Accueil',
  'nav.send': 'Envoyer',
  'nav.transfers': 'Transferts',
  'nav.settings': 'Réglages',

  'action.continue': 'Continuer',
  'action.back': 'Retour',
  'action.cancel': 'Annuler',
  'action.confirm': 'Confirmer',
  'action.retry': 'Réessayer',
  'action.signIn': 'Se connecter',
  'action.signOut': 'Se déconnecter',
  'action.signUp': 'Créer un compte',
  'action.sendMoney': 'Envoyer de l’argent',
  'action.addRecipient': 'Ajouter un bénéficiaire',
  'action.done': 'Terminé',
  'action.copy': 'Copier',
  'action.copied': 'Copié',

  'auth.signIn.title': 'Connexion',
  'auth.signUp.title': 'Créer votre compte',
  'auth.email': 'Adresse e-mail',
  'auth.password': 'Mot de passe',
  'auth.passwordHint': 'Au moins 12 caractères.',
  'auth.terms': 'J’accepte les conditions et la politique de confidentialité',
  'auth.noAccount': 'Pas encore de compte ?',
  'auth.haveAccount': 'Vous avez déjà un compte ?',
  'auth.verify.title': 'Confirmez votre e-mail',
  'auth.verify.body':
    'Nous avons envoyé un lien de confirmation. Vous pouvez regarder, mais envoyer de l’argent exige une adresse confirmée.',
  'auth.verify.resend': 'Renvoyer',
  'auth.verify.resending': 'Envoi…',
  'auth.verify.resent': 'Envoyé. Vérifiez votre boîte de réception et vos spams.',
  'auth.verify.openLink': 'Ouvrir mon lien de confirmation',
  'auth.verify.bodyNoMail':
    'Votre compte est créé. Confirmez cette adresse pour envoyer de l’argent.',
  'auth.verify.noMailServer':
    'Cette démonstration n’a pas de serveur de messagerie : le lien est affiché ici au lieu d’être envoyé par e-mail. Il n’appartient qu’à vous — personne d’autre ne le voit.',
  'auth.verify.success': 'Votre e-mail est confirmé. Vous pouvez envoyer de l’argent.',

  'home.greeting': 'Envoyer de l’argent',
  'home.recent': 'Transferts récents',
  'home.empty': 'Aucun transfert pour l’instant. Le premier prend environ une minute.',
  'home.corridors': 'Où vous pouvez envoyer',

  'send.step.amount': 'Montant',
  'send.step.recipient': 'Bénéficiaire',
  'send.step.review': 'Vérification',
  'send.step.pay': 'Paiement',

  'send.amount.title': 'Combien envoyez-vous ?',
  'send.amount.youSend': 'Vous envoyez',
  'send.amount.theyReceive': 'Le bénéficiaire reçoit',
  'send.amount.corridor': 'Destination',
  'send.amount.quoteExpires': 'Ce taux tient {seconds} s',
  'send.amount.refreshQuote': 'Actualiser le taux',
  'send.amount.expired': 'Le taux a expiré. Actualisez pour voir le taux actuel.',

  'send.breakdown.title': 'Ce que cela coûte',
  'send.breakdown.sendAmount': 'Montant à convertir',
  'send.breakdown.fixedFee': 'Nos frais',
  'send.breakdown.fxMargin': 'Marge sur le taux',
  'send.breakdown.totalCost': 'Total que vous nous payez',
  'send.breakdown.totalToPay': 'Total à payer',
  'send.breakdown.midRate': 'Taux interbancaire',
  'send.breakdown.ourRate': 'Votre taux',
  'send.breakdown.atMid': 'Au taux interbancaire, le bénéficiaire recevrait',
  'send.breakdown.explain':
    'Nous affichons le taux interbancaire et notre marge séparément. Rien n’est caché dans le taux.',

  'send.recipient.title': 'Qui reçoit ?',
  'send.recipient.saved': 'Bénéficiaires enregistrés',
  'send.recipient.new': 'Nouveau bénéficiaire',
  'send.recipient.country': 'Pays',
  'send.recipient.bank': 'Banque',
  'send.recipient.network': 'Réseau mobile money',
  'send.recipient.accountNumber': 'Numéro de compte',
  'send.recipient.msisdn': 'Numéro de mobile',
  'send.recipient.name': 'Son nom',
  'send.recipient.nickname': 'Surnom (facultatif)',
  'send.recipient.check': 'Vérifier le compte',
  'send.recipient.checking': 'Vérification auprès de la banque…',
  'send.recipient.resolved': 'La banque indique comme titulaire',
  'send.recipient.resolvedMomo': 'Le réseau indique comme titulaire',
  'send.recipient.confirmName': 'Oui, c’est bien la bonne personne',
  'send.recipient.nameMismatch':
    'Ce n’est pas le nom que vous avez saisi. Vérifiez le numéro : l’argent envoyé au mauvais compte est irrécupérable.',
  'send.recipient.notFound':
    'Aucun compte ne correspond à ce numéro. Vérifiez les chiffres et l’établissement.',

  'send.review.title': 'Vérifiez et confirmez',
  'send.review.purpose': 'Motif de l’envoi',
  'send.review.payWith': 'Payer avec',
  'send.review.commit': 'Confirmer et payer',
  'send.review.personalOnly':
    'MoraPay effectue uniquement des transferts personnels — soutien familial, études, frais médicaux et cadeaux.',

  'send.declaration.title': 'Déclaration de contrôle des changes',
  'send.declaration.intro':
    'Les fonds quittant {country} doivent être déclarés sous un code de motif publié. {authority} fixe les règles et {reportedBy} dépose la déclaration.',
  'send.declaration.category': 'Code de motif',
  'send.declaration.categoryPlaceholder': 'Choisissez le motif qui convient',
  'send.declaration.allowance': 'Votre plafond {year}',
  'send.declaration.remaining': 'Restant',
  'send.declaration.usedThroughUs': 'Utilisé via MoraPay',
  'send.declaration.usedElsewhere': 'Déjà utilisé chez d’autres prestataires cette année',
  'send.declaration.usedElsewhereHint':
    'Laissez 0 si vous n’avez rien envoyé à l’étranger par un autre prestataire cette année.',
  'send.declaration.caveat':
    'Nous ne voyons que ce que vous avez envoyé chez nous. Le plafond vous est personnel et couvre tous les prestataires : le montant ci-dessus reflète donc ce que nous connaissons, et non ce qu’il vous reste réellement. Déclarer le reste garde le compte juste.',
  'send.declaration.affirm': 'Je confirme que cette déclaration est exacte et complète.',
  'send.declaration.affirmRequired': 'Confirmez la déclaration pour continuer.',
  'send.declaration.categoryRequired': 'Choisissez un code de motif pour continuer.',

  'send.pay.title': 'Finalisez votre paiement',
  'send.pay.sbp': 'Ouvrez votre application bancaire pour approuver le paiement.',
  'send.pay.qr': 'Scannez ce code dans votre application bancaire.',
  'send.pay.account': 'Virez sur ce compte, avec la référence exactement telle qu’indiquée.',
  'send.pay.reference': 'Référence',
  'send.pay.openBank': 'Ouvrir mon application bancaire',
  'send.pay.simulate': 'Simuler le paiement (démo)',
  'send.pay.waiting': 'En attente de votre paiement…',
  'send.pay.momo':
    'Vérifiez votre téléphone. Approuvez la demande avec le code de votre portefeuille mobile.',
  'send.pay.momoWallet': 'Portefeuille',
  'send.pay.momoFallback':
    'Pas de notification ? Composez ce code et choisissez « Approuver le paiement ».',

  'purpose.FAMILY_SUPPORT': 'Soutien familial',
  'purpose.EDUCATION': 'Études',
  'purpose.MEDICAL': 'Frais médicaux',
  'purpose.GIFT': 'Cadeau',
  'purpose.OWN_ACCOUNT': 'Mon propre compte',

  'payin.SBP': 'Virement instantané (SBP)',
  'payin.QR': 'Code QR',
  'payin.CARD': 'Carte',
  'payin.VIRTUAL_ACCOUNT': 'Virement bancaire',
  'payin.MOBILE_MONEY': 'Mobile money',

  'status.draft': 'Brouillon',
  'status.awaiting_confirmation': 'En attente de votre confirmation',
  'status.checking': 'Contrôles en cours',
  'status.under_review': 'En cours d’examen',
  'status.awaiting_your_payment': 'En attente de votre paiement',
  'status.payment_received': 'Paiement reçu',
  'status.converting': 'Conversion',
  'status.sending_to_recipient': 'Envoi au bénéficiaire',
  'status.delivered': 'Remis',
  'status.completed': 'Terminé',
  'status.refund_in_progress': 'Remboursement en cours',
  'status.refunded': 'Remboursé',
  'status.failed': 'N’a pas pu aboutir',

  'status.help.under_review':
    'Chaque transfert est contrôlé face aux listes de sanctions. Le nôtre a signalé quelque chose et une personne l’examine. Nous vous écrirons.',
  'status.help.refunded':
    'Votre argent revient, frais compris. Nous ne gardons pas de frais pour un transfert que nous n’avons pas livré.',

  'transfer.reference': 'Référence',
  'transfer.timeline': 'Progression',
  'transfer.recipient': 'Bénéficiaire',
  'transfer.sent': 'Envoyé',
  'transfer.received': 'Reçu',
  'transfer.track': 'Suivre',

  'kyc.title': 'Vérifiez votre identité',
  'kyc.tier': 'Niveau {tier}',
  'kyc.current': 'Vous êtes au niveau {tier}.',
  'kyc.limitNote': 'Le niveau {tier} permet d’envoyer jusqu’à {limit} par transfert.',
  'kyc.required': 'Documents requis',
  'kyc.alternatives': 'L’un de ceux-ci convient aussi',
  'kyc.submit': 'Envoyer pour vérification',
  'kyc.submitted': 'Envoyé. La plupart des contrôles aboutissent en quelques minutes.',
  'kyc.tier0Block':
    'Votre identité n’est pas encore vérifiée, vous ne pouvez donc pas envoyer d’argent. Cela prend quelques minutes.',
  'kyc.upgradePrompt': 'Ce montant exige le niveau {tier}. Vérifiez votre identité pour l’envoyer.',
  'kyc.firstName': 'Prénom',
  'kyc.lastName': 'Nom',
  'kyc.dateOfBirth': 'Date de naissance',
  'kyc.nationality': 'Nationalité',
  'kyc.documents': 'Documents',
  'kyc.upload': 'Joindre',
  'kyc.attached': 'Joint',
  'kyc.identity': 'Identité au {country}',
  'kyc.bvn': 'Numéro de vérification bancaire (BVN)',
  'kyc.bvnHint': 'Onze chiffres. Composez *565*0# si vous ne l’avez pas sous la main.',
  'kyc.ghanaCard': 'Numéro de Ghana Card',
  'kyc.ghanaCardHint': 'GHA-123456789-0',
  'kyc.wallet': 'Portefeuille mobile money à débiter',
  'kyc.walletHint': 'Il doit être enregistré au nom indiqué ci-dessus.',
  'kyc.walletNetwork': 'Opérateur',
  'kyc.nationalId': 'Numéro d’identité nationale',
  'kyc.taxReference': 'Référence fiscale SARS (facultatif)',
  'kyc.taxReferenceHint':
    'Nécessaire uniquement pour le plafond d’investissement. Le plafond discrétionnaire ne l’exige pas.',
  'kyc.exchangeControlStatus': 'Statut au regard du contrôle des changes',
  'kyc.exchangeControlHint':
    'Résidents, résidents temporaires et non-résidents ont des plafonds différents. Seuls les résidents peuvent envoyer aujourd’hui.',
  'kyc.status.RESIDENT': 'Résident',
  'kyc.status.TEMPORARY_RESIDENT': 'Résident temporaire',
  'kyc.status.NON_RESIDENT': 'Non-résident',

  'settings.title': 'Réglages',
  'settings.language': 'Langue',
  'settings.account': 'Compte',
  'settings.verification': 'Vérification d’identité',
  'settings.manage': 'Gérer',
  'settings.install': 'Installer l’application',
  'settings.installHint':
    'Ajoutez MoraPay à votre écran d’accueil. Fonctionne même avec une connexion faible.',

  'error.offline':
    'Vous êtes hors ligne. Nous avons gardé votre étape — réessayez quand vous aurez du réseau.',
  'error.generic': 'Une erreur est survenue. Veuillez réessayer.',
  'error.QUOTE_EXPIRED': 'Ce taux a expiré. Demandez-en un nouveau.',
  'error.LIMIT_EXCEEDED': 'C’est au-dessus de votre limite.',
  'error.EMAIL_NOT_VERIFIED': 'Confirmez d’abord votre adresse e-mail.',
  'error.RECIPIENT_NAME_MISMATCH': 'Le nom ne correspond pas au compte.',
  'error.INVALID_CREDENTIALS': 'E-mail ou mot de passe incorrect.',
  'error.RATE_UNAVAILABLE':
    'Nous ne pouvons pas fixer de prix maintenant — notre flux de taux est périmé et nous ne devinerons pas. Réessayez bientôt.',
  'error.EXCHANGE_CONTROL_ALLOWANCE_EXCEEDED':
    'Compte tenu de ce que vous avez déclaré avoir utilisé ailleurs, ce transfert dépasserait votre plafond annuel. Envoyez un montant plus faible, ou parlez du plafond d’investissement à votre banque.',
  'error.EXCHANGE_CONTROL_CATEGORY_REQUIRED': 'Choisissez un code de motif avant d’envoyer.',
  'error.EXCHANGE_CONTROL_CATEGORY_UNKNOWN':
    'Ce code de motif ne peut pas être déclaré. Choisissez-en un autre.',
  'error.EXCHANGE_CONTROL_TAX_CLEARANCE_REQUIRED':
    'Ce motif exige une référence fiscale à votre dossier. Ajoutez-la d’abord dans vos informations de vérification.',
  'error.EXCHANGE_CONTROL_UNDER_AGE':
    'Ce plafond n’est ouvert qu’à partir de la majorité, que la date de naissance dont nous disposons n’atteint pas.',
  'error.EXCHANGE_CONTROL_SUBJECT_MISSING':
    'Nous ne détenons pas les informations vérifiées qu’exige cette déclaration. Terminez d’abord la vérification.',
  'error.EXCHANGE_CONTROL_STATUS_UNSUPPORTED':
    'Seuls les résidents peuvent envoyer sur cette route aujourd’hui. Les résidents temporaires et non-résidents relèvent de règles différentes, que nous n’avons pas encore construites.',

  'notifications.title': 'Notifications',
  'notifications.empty': 'Rien pour l’instant. Les nouvelles de vos transferts apparaîtront ici.',
  'notifications.markAll': 'Tout marquer comme lu',
  'notifications.unread': 'Non lu',

  'receipt.title': 'Reçu',
  'receipt.subtitle': 'Preuve de paiement',
  'receipt.print': 'Imprimer ou enregistrer en PDF',
  'receipt.reference': 'Référence',
  'receipt.valueDate': 'Envoyé',
  'receipt.completedAt': 'Livré',
  'receipt.sender': 'Expéditeur',
  'receipt.from': 'Envoyé depuis',
  'receipt.recipient': 'Bénéficiaire',
  'receipt.account': 'Compte',
  'receipt.regime': 'Déclaré auprès de',
  'receipt.issued': 'Émis le {at}. MoraPay — environnement de démonstration.',
  'receipt.view': 'Reçu',

  'schedules.title': 'Ordres permanents',
  'schedules.explain':
    'Un ordre permanent prépare votre transfert le jour choisi et vous prévient qu’il est prêt. Il ne prélève jamais de lui-même — vous approuvez toujours le paiement.',
  'schedules.yours': 'Vos ordres',
  'schedules.new': 'Nouvel ordre',
  'schedules.to': 'à',
  'schedules.next': 'Prochain',
  'schedules.prepared': 'préparé {count} fois',
  'schedules.lastFailed': 'Le dernier n’a pas pu être préparé',
  'schedules.active': 'Actif',
  'schedules.paused': 'En pause',
  'schedules.pause': 'Mettre en pause',
  'schedules.resume': 'Reprendre',
  'schedules.frequency': 'Fréquence',
  'schedules.monthly': 'Chaque mois',
  'schedules.weekly': 'Chaque semaine',
  'schedules.monthlyOn': 'le {day} de chaque mois',
  'schedules.weeklyOn': 'chaque semaine, jour {day}',
  'schedules.dayOfMonth': 'Jour du mois',
  'schedules.dayOfWeek': 'Jour de la semaine',
  'schedules.dayCap': 'Jusqu’au 28, pour que l’ordre ne saute jamais un mois trop court.',
  'schedules.chooseRecipient': 'Choisissez un bénéficiaire enregistré',
  'schedules.create': 'Créer l’ordre',

  'weekday.1': 'Lundi',
  'weekday.2': 'Mardi',
  'weekday.3': 'Mercredi',
  'weekday.4': 'Jeudi',
  'weekday.5': 'Vendredi',
  'weekday.6': 'Samedi',
  'weekday.7': 'Dimanche',

  'alerts.title': 'Alertes de taux',
  'alerts.explain':
    'Nous vous prévenons quand le taux atteint votre valeur. Le taux surveillé est celui qui vous serait proposé, marge comprise — pas le taux du marché.',
  'alerts.yours': 'Vos alertes',
  'alerts.new': 'Nouvelle alerte',
  'alerts.when': 'Prévenez-moi quand le taux est',
  'alerts.above': 'égal ou supérieur à',
  'alerts.below': 'égal ou inférieur à',
  'alerts.threshold': 'Taux',
  'alerts.thresholdHint': '{to} pour 1 {from}',
  'alerts.create': 'Surveiller ce taux',
  'alerts.remove': 'Supprimer',
  'alerts.watching': 'En veille',
  'alerts.fired': 'Envoyée',
  'alerts.currently': 'Actuellement {rate}',
  'alerts.rateUnavailable': 'Taux indisponible actuellement',
  'alerts.firedAt': 'Atteint {rate} le {at}',
  'alerts.notHeld':
    'Une alerte ne bloque pas le taux. À sa réception, ouvrez l’application pour un devis en direct.',

  'support.title': 'Aide',
  'support.new': 'Posez-nous une question',
  'support.subject': 'Objet',
  'support.message': 'Que se passe-t-il ?',
  'support.noSecrets': 'N’indiquez jamais votre mot de passe ni un code à usage unique.',
  'support.open': 'Envoyer au support',
  'support.reply': 'Réponse',
  'support.send': 'Envoyer la réponse',
  'support.you': 'Vous',
  'support.status.OPEN': 'En attente de notre part',
  'support.status.ANSWERED': 'Répondu',
  'support.status.RESOLVED': 'Résolu',

  'transfer.sendAgain': 'Envoyer à nouveau',

  'demo.banner': 'Environnement de démonstration — aucun argent réel ne circule.',
};

const DICTIONARIES: Record<Locale, Record<TranslationKey, string>> = { en, ru, fr };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Look up a key, substituting `{placeholders}`.
 *
 * Falls back to English rather than to the key itself: an untranslated string
 * a user can read beats a developer identifier they cannot.
 */
export function translate(
  locale: Locale,
  key: TranslationKey,
  params: Record<string, string | number> = {},
): string {
  const template = DICTIONARIES[locale][key] ?? en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function translatorFor(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params);
}

/** Best guess from the browser, defaulting to Russian — that is where senders are. */
export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'ru';
  for (const candidate of navigator.languages ?? [navigator.language]) {
    const short = candidate.slice(0, 2).toLowerCase();
    if (isLocale(short)) return short;
  }
  return 'ru';
}
