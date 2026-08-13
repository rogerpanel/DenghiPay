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

  'send.pay.title': 'Complete your payment',
  'send.pay.sbp': 'Open your bank app to approve the payment.',
  'send.pay.qr': 'Scan this code in your bank app.',
  'send.pay.account': 'Transfer to this account, using the reference exactly as shown.',
  'send.pay.reference': 'Reference',
  'send.pay.openBank': 'Open my bank app',
  'send.pay.simulate': 'Simulate the payment (demo)',
  'send.pay.waiting': 'Waiting for your payment…',

  'purpose.FAMILY_SUPPORT': 'Family support',
  'purpose.EDUCATION': 'Education',
  'purpose.MEDICAL': 'Medical',
  'purpose.GIFT': 'Gift',
  'purpose.OWN_ACCOUNT': 'My own account',

  'payin.SBP': 'Instant bank transfer (SBP)',
  'payin.QR': 'QR code',
  'payin.CARD': 'Card',
  'payin.VIRTUAL_ACCOUNT': 'Bank transfer',

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

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.account': 'Account',
  'settings.verification': 'Identity verification',
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

  'compliance.note': 'Personal transfers only. Every transfer is screened against sanctions lists.',
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

  'send.pay.title': 'Завершите оплату',
  'send.pay.sbp': 'Откройте приложение банка и подтвердите платёж.',
  'send.pay.qr': 'Отсканируйте код в приложении банка.',
  'send.pay.account': 'Переведите на этот счёт, указав назначение точно как показано.',
  'send.pay.reference': 'Назначение',
  'send.pay.openBank': 'Открыть приложение банка',
  'send.pay.simulate': 'Смоделировать оплату (демо)',
  'send.pay.waiting': 'Ждём вашу оплату…',

  'purpose.FAMILY_SUPPORT': 'Поддержка семьи',
  'purpose.EDUCATION': 'Обучение',
  'purpose.MEDICAL': 'Лечение',
  'purpose.GIFT': 'Подарок',
  'purpose.OWN_ACCOUNT': 'Свой счёт',

  'payin.SBP': 'Мгновенный перевод (СБП)',
  'payin.QR': 'QR-код',
  'payin.CARD': 'Карта',
  'payin.VIRTUAL_ACCOUNT': 'Банковский перевод',

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

  'settings.title': 'Настройки',
  'settings.language': 'Язык',
  'settings.account': 'Аккаунт',
  'settings.verification': 'Подтверждение личности',
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

  'compliance.note': 'Только личные переводы. Каждый перевод проверяется по санкционным спискам.',
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

  'send.pay.title': 'Finalisez votre paiement',
  'send.pay.sbp': 'Ouvrez votre application bancaire pour approuver le paiement.',
  'send.pay.qr': 'Scannez ce code dans votre application bancaire.',
  'send.pay.account': 'Virez sur ce compte, avec la référence exactement telle qu’indiquée.',
  'send.pay.reference': 'Référence',
  'send.pay.openBank': 'Ouvrir mon application bancaire',
  'send.pay.simulate': 'Simuler le paiement (démo)',
  'send.pay.waiting': 'En attente de votre paiement…',

  'purpose.FAMILY_SUPPORT': 'Soutien familial',
  'purpose.EDUCATION': 'Études',
  'purpose.MEDICAL': 'Frais médicaux',
  'purpose.GIFT': 'Cadeau',
  'purpose.OWN_ACCOUNT': 'Mon propre compte',

  'payin.SBP': 'Virement instantané (SBP)',
  'payin.QR': 'Code QR',
  'payin.CARD': 'Carte',
  'payin.VIRTUAL_ACCOUNT': 'Virement bancaire',

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

  'settings.title': 'Réglages',
  'settings.language': 'Langue',
  'settings.account': 'Compte',
  'settings.verification': 'Vérification d’identité',
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

  'compliance.note':
    'Transferts personnels uniquement. Chaque transfert est contrôlé face aux listes de sanctions.',
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
