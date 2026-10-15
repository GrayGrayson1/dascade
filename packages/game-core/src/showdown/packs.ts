/**
 * Built-in DAS Survey Showdown question packs ("We surveyed 100 DAS people…").
 *
 * SERVER-ONLY CONTENT: the answers are hidden information, so this file is imported by the game
 * server (through @dascade/game-core/showdown) and never by the web client — a bundled answer list
 * would let anyone read the board in DevTools. The client only knows the pack metadata in
 * @dascade/shared/games/showdown (titles, blurbs, round counts).
 *
 * Answers are listed most popular first with their survey points (each board totals at most 100).
 * `aliases` are extra spellings the audience may type; they are never shown.
 */
import type { Rng } from '@dascade/shared';
import { SHOWDOWN_PACK_IDS, type ShowdownAnswer, type ShowdownPackId, type ShowdownRoundDef } from '@dascade/shared/games/showdown';

type A = [text: string, points: number, aliases?: string[]];

function q(id: string, prompt: string, answers: A[]): ShowdownRoundDef {
  return {
    id,
    prompt,
    answers: answers.map(([text, points, aliases]): ShowdownAnswer => ({ text, points, aliases: aliases ?? [] })),
  };
}

export const SHOWDOWN_PACKS: Record<ShowdownPackId, ShowdownRoundDef[]> = {
  spooky: [
    q('spooky-01', 'Name something you would find in a haunted house.', [
      ['Ghosts', 32, ['ghost', 'spirits', 'phantom']],
      ['Cobwebs', 21, ['spider webs', 'webs', 'spiderweb', 'spiders']],
      ['Skeletons', 12, ['skeleton', 'bones']],
      ['Bats', 9, ['bat']],
      ['Creaky doors', 8, ['creaky door', 'squeaky door', 'creaking door']],
      ['Vampire', 6, ['vampires', 'dracula']],
      ['Coffin', 5, ['coffins', 'casket']],
      ['Black cat', 4, ['cat', 'black cats']],
    ]),
    q('spooky-02', 'Name a popular Halloween costume.', [
      ['Witch', 24, ['witches']],
      ['Vampire', 18, ['dracula']],
      ['Ghost', 14, ['sheet ghost']],
      ['Zombie', 11, ['zombies']],
      ['Superhero', 10, ['spiderman', 'batman', 'superman', 'wonder woman']],
      ['Pirate', 8, ['pirates']],
      ['Skeleton', 6, []],
      ['Princess', 5, ['fairy princess']],
    ]),
    q('spooky-03', 'Name a treat you hope to get while trick-or-treating.', [
      ['Chocolate bar', 30, ['chocolate', 'candy bar', 'chocolate bars']],
      ['Peanut butter cups', 18, ['peanut butter cup', 'reeses', 'peanut butter']],
      ['Lollipop', 11, ['lollipops', 'sucker', 'suckers']],
      ['Gummy bears', 10, ['gummies', 'gummy', 'gummy worms']],
      ['Candy corn', 8, []],
      ['Caramel', 7, ['caramels', 'toffee']],
      ['Full-size candy bar', 6, ['full size bar', 'king size']],
      ['Licorice', 4, ['liquorice']],
    ]),
    q('spooky-04', 'Name something people carve or decorate for Halloween.', [
      ['Pumpkins', 52, ['pumpkin', 'jack-o-lantern', 'jack o lantern', 'jack o lanterns']],
      ['Front door', 12, ['door', 'doors']],
      ['Porch', 10, ['front porch', 'steps']],
      ['Windows', 8, ['window']],
      ['Gourds', 6, ['gourd', 'squash']],
      ['Yard', 5, ['lawn', 'garden', 'front yard']],
      ['Cookies', 4, ['cookie', 'cupcakes', 'cake']],
    ]),
    q('spooky-05', 'Name something a vampire would hate.', [
      ['Garlic', 38, []],
      ['Sunlight', 26, ['sun', 'daylight', 'sunshine', 'daytime']],
      ['Wooden stake', 14, ['stake', 'stakes']],
      ['Cross', 9, ['crucifix', 'crosses']],
      ['Holy water', 6, ['water']],
      ['Mirrors', 4, ['mirror']],
    ]),
    q('spooky-06', 'Name a sound you would hear on a spooky night.', [
      ['Howling wolf', 28, ['wolf', 'wolves', 'howl', 'howling', 'wolf howl']],
      ['Creaking door', 20, ['creak', 'door creaking', 'creaky door']],
      ['Owl hoot', 15, ['owl', 'hoot', 'owls', 'hooting']],
      ['Thunder', 12, ['thunderstorm', 'storm']],
      ['Scream', 9, ['screaming', 'screams']],
      ['Wind', 7, ['howling wind']],
      ['Footsteps', 5, ['steps']],
      ['Rattling chains', 3, ['chains', 'chain']],
    ]),
    q('spooky-07', 'Name something a witch might keep in her kitchen.', [
      ['Cauldron', 34, ['pot', 'cauldrons']],
      ['Broomstick', 20, ['broom', 'brooms']],
      ['Spell book', 14, ['spellbook', 'book', 'book of spells']],
      ['Black cat', 10, ['cat']],
      ['Potions', 9, ['potion']],
      ['Eye of newt', 5, ['newt', 'eyeballs', 'eyes']],
      ['Frogs', 4, ['frog', 'toads', 'toad']],
    ]),
    q('spooky-08', 'Name a classic movie monster.', [
      ['Zombie', 22, ['zombies']],
      ['Vampire', 19, ['dracula']],
      ['Werewolf', 16, ['wolfman', 'wolf man']],
      ['Mummy', 12, ['the mummy']],
      ['Frankenstein', 11, ["frankenstein's monster", 'frankensteins monster']],
      ['Ghost', 8, ['ghosts']],
      ['Alien', 5, ['aliens']],
      ['Godzilla', 4, ['giant lizard']],
    ]),
    q('spooky-09', 'Name a reason you would leave a Halloween party early.', [
      ['Too scary', 25, ['scared', 'got scared', 'scary']],
      ['Uncomfortable costume', 18, ['costume', 'itchy costume', 'costume hurts']],
      ['Too tired', 16, ['tired', 'sleepy', 'exhausted']],
      ['Ate too much candy', 12, ['candy', 'stomach ache', 'sick']],
      ['Work tomorrow', 10, ['work', 'early meeting', 'meeting']],
      ['Bad music', 7, ['music']],
      ['Ran into my boss', 5, ['boss']],
    ]),
    q('spooky-10', 'Name something you might see in a graveyard at midnight.', [
      ['Tombstones', 30, ['tombstone', 'gravestones', 'headstones', 'graves']],
      ['Ghosts', 24, ['ghost', 'spirits']],
      ['Fog', 14, ['mist']],
      ['Zombies', 10, ['zombie']],
      ['Bats', 7, ['bat']],
      ['Full moon', 6, ['moon']],
      ['Crows', 5, ['crow', 'ravens', 'raven']],
      ['Groundskeeper', 3, ['caretaker', 'gravedigger']],
    ]),
  ],
  office: [
    q('office-01', 'Name something people do during a boring meeting.', [
      ['Check their phone', 31, ['phone', 'text', 'texting', 'look at phone']],
      ['Doodle', 18, ['draw', 'drawing', 'doodling', 'sketch']],
      ['Daydream', 14, ['zone out', 'space out', 'daydreaming']],
      ['Check email', 11, ['email', 'emails', 'answer emails']],
      ['Fall asleep', 9, ['sleep', 'nap', 'doze off']],
      ['Snack', 6, ['eat', 'eating', 'snacking']],
      ['Watch the clock', 5, ['clock', 'check the time']],
      ['Nod along', 3, ['nod', 'nodding']],
    ]),
    q('office-02', 'Name something you would find on a messy desk.', [
      ['Coffee mugs', 26, ['mug', 'mugs', 'coffee cups', 'coffee cup']],
      ['Papers', 22, ['paper', 'documents', 'paperwork']],
      ['Sticky notes', 15, ['post-its', 'post its', 'sticky note', 'post it notes']],
      ['Cables', 10, ['cords', 'chargers', 'charger', 'wires']],
      ['Snack wrappers', 9, ['wrappers', 'crumbs', 'snacks']],
      ['Pens', 7, ['pen', 'pencils']],
      ['Headphones', 5, ['earbuds', 'headset']],
      ['Plant', 3, ['plants', 'dead plant']],
    ]),
    q('office-03', 'Name a reason you might be late to work.', [
      ['Traffic', 41, ['rush hour', 'cars', 'traffic jam']],
      ['Overslept', 22, ['slept in', 'alarm', 'oversleep', 'missed alarm']],
      ['Kids', 10, ['children', 'school run', 'school drop off']],
      ['Coffee run', 8, ['coffee', 'stopped for coffee']],
      ['Car trouble', 7, ['flat tire', 'car broke down', 'car']],
      ['Weather', 5, ['snow', 'rain', 'storm']],
      ['Lost keys', 4, ['keys', 'cant find keys']],
    ]),
    q('office-04', 'Name something people fight over in the office kitchen.', [
      ['Coffee', 30, ['last cup of coffee', 'coffee pot', 'coffee machine']],
      ['Fridge space', 20, ['fridge', 'refrigerator']],
      ['Microwave', 18, ['microwave line']],
      ['Dirty dishes', 12, ['dishes', 'sink']],
      ['Snacks', 9, ['food', 'donuts', 'treats']],
      ['Stolen lunch', 5, ['lunch', 'lunch thief']],
      ['Thermostat', 3, ['temperature', 'heat']],
    ]),
    q('office-05', 'Name a phrase you hear way too often on video calls.', [
      ["You're on mute", 29, ['on mute', 'mute', 'you are on mute', 'unmute']],
      ['Can you see my screen?', 21, ['see my screen', 'share screen', 'screen share']],
      ["Let's circle back", 16, ['circle back']],
      ["Let's take this offline", 12, ['take this offline', 'offline']],
      ['Can you hear me?', 9, ['hear me', 'can you hear me']],
      ['Sorry, go ahead', 6, ['go ahead', 'sorry', 'you go']],
      ['Next slide', 5, ['next slide please']],
    ]),
    q('office-06', 'Name something people bring to a team potluck.', [
      ['Chips and dip', 22, ['chips', 'dip', 'salsa']],
      ['Cookies', 18, ['cookie']],
      ['Pasta salad', 14, ['salad', 'pasta']],
      ['Pizza', 12, []],
      ['Brownies', 9, ['brownie']],
      ['Cupcakes', 8, ['cupcake', 'cake']],
      ['Meatballs', 7, ['meatball']],
      ['Veggie tray', 6, ['veggies', 'vegetables', 'crudites']],
    ]),
    q('office-07', "Name a way to tell it's someone's first day at work.", [
      ['Overdressed', 23, ['dressed up', 'suit', 'formal', 'wearing a suit']],
      ['They get lost', 20, ['lost', 'getting lost']],
      ['Lots of questions', 16, ['questions', 'asking questions']],
      ['Nervous', 13, ['anxious', 'scared', 'shy']],
      ['Visitor badge', 9, ['badge', 'name tag', 'no badge']],
      ['Arrive early', 8, ['early', 'show up early']],
      ['Smiling a lot', 6, ['smiling', 'smile', 'happy']],
    ]),
    q('office-08', 'Name something you would hate to hear your boss say at 4:59 on a Friday.', [
      ['Got a minute?', 30, ['got a minute', 'quick question', 'do you have a minute']],
      ['We need to talk', 22, ['need to talk', 'we have to talk', 'talk']],
      ['Come in tomorrow', 16, ['work the weekend', 'weekend', 'saturday']],
      ['One more thing', 11, ['one more thing']],
      ['Mandatory meeting', 9, ['meeting', 'meeting at 5']],
      ['Overtime', 7, ['stay late', 'work late']],
      ['Start over', 3, ['redo it', 'do it again']],
    ]),
    q('office-09', 'Name something people decorate their workspace with.', [
      ['Photos', 34, ['photo', 'pictures', 'family photos', 'picture']],
      ['Plants', 22, ['plant', 'succulent', 'succulents', 'flowers']],
      ['Sticky notes', 10, ['post-its', 'post its']],
      ['Toys', 9, ['figurines', 'action figures', 'toy', 'figures']],
      ['Posters', 8, ['poster', 'art', 'artwork']],
      ['Mugs', 6, ['mug', 'coffee mugs']],
      ['String lights', 5, ['lights', 'fairy lights']],
      ['Calendar', 3, ['calendars']],
    ]),
    q('office-10', 'Name a good reason to step away from your desk.', [
      ['Coffee', 30, ['coffee break', 'get coffee']],
      ['Bathroom', 26, ['restroom', 'toilet', 'bathroom break']],
      ['Lunch', 18, ['food', 'eat', 'lunch break']],
      ['Stretch', 9, ['walk', 'stretch my legs', 'exercise']],
      ['Meeting', 8, ['meetings']],
      ['Phone call', 5, ['call', 'calls']],
      ['Fresh air', 3, ['go outside', 'outside']],
    ]),
  ],
  tech: [
    q('tech-01', 'Name something you do when your computer freezes.', [
      ['Restart it', 38, ['restart', 'reboot', 'turn it off and on', 'turn it off and on again']],
      ['Panic', 15, ['scream', 'yell', 'cry', 'swear']],
      ['Ctrl+Alt+Delete', 12, ['control alt delete', 'ctrl alt delete', 'task manager', 'ctrl alt del']],
      ['Call IT', 10, ['it', 'help desk', 'tech support', 'call it support']],
      ['Wait', 9, ['wait it out', 'be patient']],
      ['Unplug it', 6, ['unplug', 'pull the plug']],
      ['Smash the keyboard', 5, ['hit keys', 'bang the keyboard', 'mash keys']],
      ['Get coffee', 4, ['coffee']],
    ]),
    q('tech-02', 'Name a password people use way too often.', [
      ['123456', 31, ['1234', '12345', '123456789', '12345678']],
      ['Password', 26, ['password1', 'password123']],
      ["Their pet's name", 15, ['pet name', 'pets name', 'dogs name', 'dog name', 'cat name']],
      ['Birthday', 10, ['birthdate', 'birth date', 'date of birth']],
      ['Qwerty', 8, ['qwerty123']],
      ['Their own name', 5, ['name', 'own name', 'my name']],
      ['Letmein', 3, ['let me in']],
    ]),
    q('tech-03', 'Name an app people open first thing in the morning.', [
      ['Email', 28, ['mail', 'inbox', 'outlook', 'gmail']],
      ['Weather', 17, ['weather app']],
      ['Social media', 15, ['instagram', 'facebook', 'tiktok', 'twitter']],
      ['News', 12, ['news app', 'headlines']],
      ['Messages', 10, ['texts', 'text messages', 'whatsapp']],
      ['Team chat', 8, ['slack', 'teams', 'chat']],
      ['Calendar', 6, ['schedule', 'agenda']],
    ]),
    q('tech-04', 'Name something people lose all the time.', [
      ['Keys', 34, ['car keys', 'house keys', 'key']],
      ['Phone', 24, ['cell phone', 'smartphone', 'mobile']],
      ['Charger', 13, ['phone charger', 'cable', 'charging cable']],
      ['Glasses', 10, ['sunglasses', 'reading glasses']],
      ['Wallet', 8, ['purse']],
      ['TV remote', 6, ['remote', 'remote control']],
      ['Earbuds', 5, ['airpods', 'headphones', 'earbud']],
    ]),
    q('tech-05', 'Name something that always seems to need an update.', [
      ['Phone', 30, ['iphone', 'android', 'smartphone', 'cell phone']],
      ['Computer', 22, ['laptop', 'pc', 'windows', 'operating system']],
      ['Apps', 18, ['app']],
      ['Printer', 10, ['printer drivers', 'drivers']],
      ['Passwords', 9, ['password']],
      ['Browser', 6, ['web browser', 'chrome']],
      ['Smart TV', 4, ['tv', 'television']],
    ]),
    q('tech-06', "Name a gadget people say they couldn't live without.", [
      ['Smartphone', 48, ['phone', 'cell phone', 'iphone', 'mobile']],
      ['Laptop', 17, ['computer', 'pc']],
      ['Headphones', 10, ['earbuds', 'airpods', 'headset']],
      ['Coffee maker', 9, ['coffee machine', 'espresso machine']],
      ['Smartwatch', 7, ['watch', 'fitness tracker']],
      ['TV', 5, ['television', 'smart tv']],
      ['Game console', 4, ['console', 'playstation', 'xbox', 'switch']],
    ]),
    q('tech-07', 'Name something people say to IT support.', [
      ["It's not working", 31, ['not working', 'its broken', 'broken', 'it doesnt work']],
      ["I didn't touch anything", 19, ['didnt touch anything', 'didnt do anything', 'i didnt do anything']],
      ['I already restarted it', 15, ['restarted', 'rebooted', 'already restarted', 'turned it off and on']],
      ['I forgot my password', 14, ['forgot password', 'password', 'locked out']],
      ['It worked yesterday', 9, ['working yesterday', 'it was working yesterday']],
      ['Is the internet down?', 7, ['internet down', 'internet', 'wifi', 'wifi down']],
      ['Help!', 4, ['help']],
    ]),
    q('tech-08', 'Name a reason a video call goes wrong.', [
      ['Bad Wi-Fi', 33, ['wifi', 'internet', 'connection', 'lag', 'frozen', 'bad connection']],
      ['On mute', 22, ['mute', 'muted', 'forgot to unmute']],
      ['Camera trouble', 12, ['camera', 'camera off', 'video off', 'webcam']],
      ['Echo', 10, ['feedback', 'audio echo']],
      ['Pets', 8, ['dog', 'cat', 'barking dog', 'pet']],
      ['Kids walk in', 7, ['kids', 'children', 'kid']],
      ['Wrong link', 5, ['link', 'wrong meeting', 'wrong time']],
    ]),
  ],
  food: [
    q('food-01', 'Name a pizza topping.', [
      ['Pepperoni', 39, ['peperoni', 'salami']],
      ['Mushrooms', 14, ['mushroom']],
      ['Sausage', 11, ['italian sausage']],
      ['Extra cheese', 10, ['cheese']],
      ['Pineapple', 9, ['hawaiian']],
      ['Onions', 6, ['onion']],
      ['Olives', 5, ['olive', 'black olives']],
      ['Peppers', 4, ['green peppers', 'bell peppers', 'pepper']],
    ]),
    q('food-02', 'Name something people put in their coffee.', [
      ['Milk', 30, ['oat milk', 'almond milk']],
      ['Sugar', 27, ['sweetener', 'honey']],
      ['Cream', 18, ['creamer', 'half and half']],
      ['Flavored syrup', 8, ['syrup', 'vanilla', 'caramel', 'hazelnut']],
      ['Cinnamon', 5, []],
      ['Ice', 4, ['ice cubes']],
      ['Whipped cream', 3, ['whip']],
      ['Pumpkin spice', 3, ['pumpkin']],
    ]),
    q('food-03', 'Name a snack people eat while watching a movie.', [
      ['Popcorn', 58, ['pop corn']],
      ['Candy', 14, ['sweets', 'gummies', 'm&ms']],
      ['Nachos', 9, ['tortilla chips', 'chips']],
      ['Chocolate', 7, ['chocolate bar']],
      ['Pizza', 5, []],
      ['Hot dog', 3, ['hot dogs', 'hotdog']],
      ['Pretzels', 2, ['pretzel']],
    ]),
    q('food-04', 'Name a food you eat with your hands.', [
      ['Pizza', 25, []],
      ['Burger', 20, ['hamburger', 'cheeseburger', 'burgers']],
      ['Sandwich', 15, ['sandwiches', 'sub']],
      ['Tacos', 12, ['taco']],
      ['Fries', 9, ['french fries', 'chips']],
      ['Chicken wings', 8, ['wings', 'chicken']],
      ['Hot dog', 5, ['hotdog', 'hot dogs']],
      ['Sushi', 4, []],
    ]),
    q('food-05', "Name something that's always in the office fridge.", [
      ['Milk', 25, ['creamer', 'coffee creamer']],
      ['Leftovers', 22, ['takeout', 'old food', 'leftover']],
      ['Condiments', 13, ['ketchup', 'mustard', 'mayo', 'hot sauce', 'sauces']],
      ['Soda', 12, ['pop', 'soft drinks', 'cans', 'cola']],
      ['Yogurt', 10, ['yoghurt']],
      ['Water', 8, ['bottled water', 'water bottles']],
      ['Something moldy', 6, ['mold', 'moldy food', 'mystery food', 'mystery container']],
    ]),
    q('food-06', 'Name a food that tastes even better the next day.', [
      ['Pizza', 41, ['cold pizza']],
      ['Lasagna', 14, ['lasagne']],
      ['Chili', 12, ['chilli']],
      ['Curry', 9, []],
      ['Soup', 8, ['stew']],
      ['Pasta', 7, ['spaghetti', 'mac and cheese']],
      ['Fried rice', 4, ['rice', 'chinese food']],
    ]),
    q('food-07', 'Name a breakfast food.', [
      ['Eggs', 30, ['egg', 'scrambled eggs', 'omelette', 'omelet']],
      ['Pancakes', 20, ['pancake', 'flapjacks']],
      ['Bacon', 14, []],
      ['Cereal', 12, []],
      ['Toast', 9, ['bread']],
      ['Waffles', 7, ['waffle']],
      ['Oatmeal', 5, ['porridge', 'oats']],
      ['Bagel', 3, ['bagels']],
    ]),
    q('food-08', 'Name a dessert you would bring to a celebration.', [
      ['Cake', 40, ['birthday cake', 'cakes']],
      ['Cookies', 17, ['cookie']],
      ['Cupcakes', 13, ['cupcake']],
      ['Brownies', 11, ['brownie']],
      ['Pie', 8, ['apple pie', 'pumpkin pie']],
      ['Ice cream', 6, ['gelato']],
      ['Donuts', 4, ['doughnuts', 'donut']],
    ]),
  ],
  life: [
    q('life-01', 'Name something people do on a lazy Sunday.', [
      ['Sleep in', 30, ['sleep', 'nap', 'sleeping in']],
      ['Watch TV', 25, ['tv', 'binge watch', 'netflix', 'movies']],
      ['Brunch', 12, ['breakfast', 'eat']],
      ['Read', 9, ['reading', 'book']],
      ['Laundry', 8, ['chores', 'clean', 'cleaning']],
      ['Go for a walk', 7, ['walk', 'hike']],
      ['Video games', 5, ['games', 'gaming']],
    ]),
    q('life-02', 'Name something you pack for a day at the beach.', [
      ['Sunscreen', 30, ['sunblock', 'sun cream', 'suncream']],
      ['Towel', 25, ['towels', 'beach towel']],
      ['Swimsuit', 15, ['bathing suit', 'swimwear', 'trunks']],
      ['Sunglasses', 10, ['shades']],
      ['Snacks', 8, ['food', 'cooler', 'drinks']],
      ['Umbrella', 6, ['beach umbrella', 'parasol']],
      ['Book', 4, ['books', 'magazine']],
    ]),
    q('life-03', 'Name a reason people go to the gym.', [
      ['Lose weight', 32, ['weight loss', 'slim down', 'lose fat']],
      ['Get stronger', 20, ['strength', 'build muscle', 'muscles', 'lift weights']],
      ['Stay healthy', 18, ['health', 'healthy', 'fitness']],
      ['Stress relief', 10, ['stress', 'relax', 'clear my head']],
      ['Look good', 9, ['appearance', 'beach body']],
      ['See friends', 5, ['friends', 'social', 'meet people']],
    ]),
    q('life-04', 'Name a household chore nobody likes.', [
      ['Dishes', 30, ['washing dishes', 'the dishes', 'washing up']],
      ['Laundry', 22, ['folding laundry', 'folding clothes']],
      ['Cleaning the bathroom', 17, ['bathroom', 'toilet', 'scrubbing the toilet']],
      ['Vacuuming', 10, ['vacuum', 'hoovering']],
      ['Taking out the trash', 9, ['trash', 'garbage', 'bins']],
      ['Ironing', 7, ['iron']],
      ['Mowing the lawn', 4, ['mow', 'lawn', 'yard work']],
    ]),
    q('life-05', 'Name something people collect.', [
      ['Coins', 22, ['coin']],
      ['Stamps', 18, ['stamp']],
      ['Trading cards', 14, ['cards', 'baseball cards', 'pokemon cards']],
      ['Sneakers', 10, ['shoes']],
      ['Records', 9, ['vinyl', 'albums']],
      ['Comic books', 8, ['comics']],
      ['Mugs', 6, ['mug']],
      ['Rocks', 5, ['crystals', 'stones']],
    ]),
    q('life-06', "Name something you'd hate to forget on vacation.", [
      ['Passport', 34, ['id', 'identification']],
      ['Phone', 20, ['cell phone', 'smartphone']],
      ['Charger', 14, ['phone charger']],
      ['Wallet', 12, ['money', 'credit card', 'cash']],
      ['Medication', 8, ['medicine', 'meds', 'pills']],
      ['Toothbrush', 7, []],
      ['Underwear', 4, ['socks']],
    ]),
    q('life-07', 'Name a game families play at the kitchen table.', [
      ['Monopoly', 34, []],
      ['Uno', 18, []],
      ['Scrabble', 12, []],
      ['Chess', 10, []],
      ['Clue', 8, ['cluedo']],
      ['Poker', 6, ['cards', 'card games']],
      ['Checkers', 5, ['draughts']],
      ['Jenga', 4, []],
    ]),
    q('life-08', 'Name something people do to relax after work.', [
      ['Watch TV', 30, ['tv', 'netflix', 'binge', 'shows']],
      ['Take a nap', 15, ['nap', 'sleep']],
      ['Exercise', 13, ['gym', 'workout', 'run', 'walk']],
      ['Have a drink', 12, ['wine', 'beer', 'cocktail', 'drink']],
      ['Read', 9, ['book', 'reading']],
      ['Video games', 8, ['games', 'gaming']],
      ['Take a bath', 7, ['bath', 'shower']],
      ['Cook dinner', 4, ['cook', 'cooking']],
    ]),
  ],
};

/**
 * Draws `count` rounds from the chosen packs: unseen questions first (`seen` = ids already played in
 * this room), shuffled with the room's RNG. Fewer questions than requested → as many as exist.
 */
export function pickRounds(packs: readonly ShowdownPackId[], count: number, rng: Rng, seen: ReadonlySet<string> = new Set()): ShowdownRoundDef[] {
  const pool = SHOWDOWN_PACK_IDS.filter((id) => packs.includes(id)).flatMap((id) => SHOWDOWN_PACKS[id]);
  const fresh = pool.filter((r) => !seen.has(r.id));
  const stale = pool.filter((r) => seen.has(r.id));
  const shuffled = [...shuffle(fresh, rng), ...shuffle(stale, rng)];
  return shuffled.slice(0, Math.max(0, count)).map((r) => structuredClone(r));
}

function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
