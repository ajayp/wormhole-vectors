import { randomUUID } from "crypto";
import { ensureCore, insertDocuments, Doc } from "../src/solr";
import { embedBatch } from "../src/embed";
import { factorize } from "../src/mf";
import { generateInteractions } from "./interactions";

process.loadEnvFile();

const RAW_DOCS = [
  // ── JAVA: Programming ────────────────────────────────────────────
  { title: "Java Programming Fundamentals", text: "Java is an object-oriented programming language running on the JVM. Classes, inheritance, and interfaces are core concepts.", source: "java_programming" },
  { title: "JVM Architecture Deep Dive", text: "The Java Virtual Machine manages bytecode execution, garbage collection, and memory through heap and stack regions.", source: "java_programming" },
  { title: "Spring Framework Essentials", text: "Spring is a Java backend framework providing dependency injection, AOP, and MVC patterns for enterprise applications.", source: "java_programming" },
  { title: "Hibernate ORM Guide", text: "Hibernate maps Java objects to relational database tables. It handles transactions, caching, and lazy loading automatically.", source: "java_programming" },
  { title: "Java Garbage Collection Tuning", text: "Tuning JVM garbage collection improves throughput. G1GC and ZGC are modern low-pause collectors for heap management.", source: "java_programming" },
  { title: "Maven Build System", text: "Maven manages Java project dependencies, build lifecycle, and artifact publishing via pom.xml configuration.", source: "java_programming" },
  { title: "Java Concurrency in Practice", text: "Java threading uses synchronized blocks, Executors, and CompletableFuture. The JVM provides volatile and atomic primitives.", source: "java_programming" },
  { title: "Microservices with Java", text: "Spring Boot enables Java microservices with embedded Tomcat, auto-configuration, and actuator health endpoints.", source: "java_programming" },
  { title: "Java Collections Framework", text: "ArrayList, HashMap, and TreeSet are core JVM collection types. Generics provide compile-time type safety for collections.", source: "java_programming" },
  { title: "Scala for Java Developers", text: "Scala runs on the JVM and interoperates with Java libraries. Functional programming and pattern matching extend Java paradigms.", source: "java_programming" },
  { title: "Java Memory Model Explained", text: "The Java memory model defines thread visibility rules. Heap objects are shared; stack frames are thread-local in the JVM.", source: "java_programming" },
  { title: "Kafka with Java", text: "Apache Kafka producers and consumers are implemented in Java. Spring Kafka provides annotation-driven message listeners.", source: "java_programming" },
  { title: "Java Design Patterns", text: "Singleton, Factory, and Observer are classic object-oriented patterns commonly applied in Java enterprise codebases.", source: "java_programming" },
  { title: "RESTful APIs in Java", text: "JAX-RS and Spring MVC provide annotations for building REST endpoints. Jackson handles JSON serialization in Java.", source: "java_programming" },
  { title: "Java Performance Profiling", text: "JProfiler and async-profiler identify JVM hotspots. Bytecode instrumentation tracks heap allocations and garbage collection pauses.", source: "java_programming" },
  { title: "Unit Testing with JUnit", text: "JUnit 5 provides annotations like @Test and @BeforeEach. Mockito mocks Java dependencies for isolated unit tests.", source: "java_programming" },
  { title: "Java Stream API", text: "Java streams enable functional-style operations on collections: filter, map, reduce, and collect pipeline transformations.", source: "java_programming" },
  { title: "Kotlin on the JVM", text: "Kotlin compiles to JVM bytecode and interoperates with Java. Null safety, coroutines, and data classes modernize JVM development.", source: "java_programming" },

  // ── JAVA: Coffee ─────────────────────────────────────────────────
  { title: "Java Coffee Origins", text: "Java coffee comes from the Indonesian island of Java. Volcanic soil and tropical humidity produce distinctively earthy beans.", source: "java_coffee" },
  { title: "Sumatra Coffee Roasting Guide", text: "Sumatran coffee beans from the Indonesian islands are wet-hulled. This process yields a full-bodied, low-acidity roast.", source: "java_coffee" },
  { title: "Arabica Cultivation in Java", text: "Java island arabica cultivation thrives on volcanic slopes. Farmers harvest coffee cherries by hand during the dry season.", source: "java_coffee" },
  { title: "Indonesian Coffee Trade History", text: "Dutch colonists established coffee plantations on Java island in the 17th century. Indonesian coffee exports shaped the global commodity market.", source: "java_coffee" },
  { title: "Java Estate Coffee Review", text: "Java estate single-origin beans brew a syrupy cup with chocolate and cedar notes. Best as a pour-over or French press.", source: "java_coffee" },
  { title: "Brewing Methods for Indonesian Coffee", text: "Java and Sumatra coffees excel with immersion brewing. Cafetière and cold brew extract their earthy, herbal character.", source: "java_coffee" },
  { title: "Coffee Bean Processing on Java Island", text: "Wet-hulling — called Giling Basah — is unique to Indonesian coffee processing. Beans are hulled at high moisture, producing a dark, spicy roast.", source: "java_coffee" },
  { title: "Mandheling Coffee from Sumatra", text: "Mandheling is a prized Sumatran arabica coffee. Grown near Lake Toba, it exhibits earthy, tobacco, and dark chocolate flavor notes.", source: "java_coffee" },
  { title: "Java Mocha Coffee Blend", text: "The classic Java Mocha blend combines Indonesian Java arabica with Yemeni Mocha beans. A traditional pairing dating to 18th-century coffeehouses.", source: "java_coffee" },
  { title: "Indonesian Coffee Varietals", text: "Lintong, Gayo, and Flores are distinct Indonesian coffee-growing regions. Each island terroir produces unique bean characteristics.", source: "java_coffee" },
  { title: "Coffee Harvesting Seasons in Java", text: "Java coffee cherries ripen during the dry season. Selective hand-picking ensures only ripe red cherries enter the processing mill.", source: "java_coffee" },
  { title: "Specialty Coffee Roasters and Java", text: "Third-wave specialty roasters source Java island single-origin beans directly from cooperatives. Light roasting preserves delicate floral notes.", source: "java_coffee" },
  { title: "Kopi Luwak from Indonesia", text: "Kopi Luwak is a rare Indonesian coffee made from beans eaten and excreted by Asian palm civets. Java and Sumatra are primary sources.", source: "java_coffee" },
  { title: "Terroir of Indonesian Coffee Islands", text: "Java, Sumatra, Sulawesi, and Flores each offer distinct coffee terroir. Elevation, rainfall, and soil composition define flavor profiles.", source: "java_coffee" },
  { title: "Cold Brew with Java Beans", text: "Java island coffee beans are well-suited for cold brew. Their low acidity and earthy body develop over 18-hour cold steeping.", source: "java_coffee" },
  { title: "Coffee Cooperatives in Sumatra", text: "Fair-trade cooperatives in Sumatra's Aceh province support small-holder arabica farmers. Direct trade improves bean quality and farmer income.", source: "java_coffee" },
  { title: "Javanese Coffee Ceremony", text: "Traditional Javanese coffee preparation uses a clay pot and charcoal stove. Unfiltered grounds settle before the coffee is poured and served.", source: "java_coffee" },

  // ── MERCURY: Planet ───────────────────────────────────────────────
  { title: "Mercury: Closest Planet to the Sun", text: "Mercury orbits the Sun in 88 Earth days. Its surface is heavily cratered, similar to the Moon, with extreme temperature swings.", source: "mercury_planet" },
  { title: "NASA MESSENGER Mission to Mercury", text: "NASA's MESSENGER spacecraft orbited Mercury from 2011–2015, mapping its surface and discovering water ice in permanently shadowed craters.", source: "mercury_planet" },
  { title: "Mercury's Geological Features", text: "Mercury has large scarps called rupes formed by planetary contraction. Caloris Basin is the largest impact crater on its surface.", source: "mercury_planet" },
  { title: "BepiColombo Mercury Orbiter", text: "ESA and JAXA's BepiColombo mission launched in 2018. It will enter Mercury orbit in 2025 to study its magnetic field and geology.", source: "mercury_planet" },
  { title: "Mercury's Magnetic Field", text: "Mercury has a weak global magnetic field, about 1% of Earth's. It interacts with the solar wind to form a miniature magnetosphere.", source: "mercury_planet" },
  { title: "Temperature Extremes on Mercury", text: "Mercury's surface reaches 430°C at noon and −180°C at night. Its thin exosphere provides no insulating effect against solar radiation.", source: "mercury_planet" },
  { title: "Mercury Transit Observations", text: "Mercury transits occur when it passes directly between Earth and the Sun. Astronomers use transits to refine solar system measurements.", source: "mercury_planet" },
  { title: "Mariner 10 Flyby of Mercury", text: "Mariner 10 was the first spacecraft to visit Mercury in 1974. It imaged 45% of the surface and measured Mercury's magnetic field.", source: "mercury_planet" },
  { title: "Mercury's Core Composition", text: "Mercury has an oversized iron core comprising 85% of its radius. Researchers believe a giant impact stripped away much of its mantle.", source: "mercury_planet" },
  { title: "Hollows on Mercury's Surface", text: "Mercury has unique shallow depressions called hollows, formed by volatile material sublimating from the crust under intense solar heating.", source: "mercury_planet" },
  { title: "Mercury and the Solar Wind", text: "Because Mercury lacks a thick atmosphere, the solar wind directly sputters its surface, releasing sodium atoms into its exosphere.", source: "mercury_planet" },
  { title: "Observing Mercury at Dusk", text: "Mercury is only visible near the horizon after sunset or before sunrise. Its elongation from the Sun never exceeds 28 degrees.", source: "mercury_planet" },

  // ── MERCURY: Element ──────────────────────────────────────────────
  { title: "Mercury the Chemical Element", text: "Mercury (Hg) is a liquid metal at room temperature. Atomic number 80, it belongs to the d-block transition metals on the periodic table.", source: "mercury_element" },
  { title: "Mercury Toxicity and Health Risks", text: "Mercury poisoning causes neurological damage. Methylmercury bioaccumulates in fish tissue; elemental mercury vapor is hazardous by inhalation.", source: "mercury_element" },
  { title: "Mercury in Thermometers", text: "Mercury thermometers exploit mercury's uniform thermal expansion. Most countries have phased them out due to mercury's toxicity risk.", source: "mercury_element" },
  { title: "Mining and Extraction of Mercury", text: "Mercury is mined from cinnabar ore (mercury sulfide). Spain's Almadén mine was historically the world's largest mercury source.", source: "mercury_element" },
  { title: "Mercury Amalgam in Dentistry", text: "Dental amalgam is an alloy of mercury, silver, tin, and copper. Despite mercury content, amalgam fillings are considered safe by health authorities.", source: "mercury_element" },
  { title: "Mercury Vapor Lamps", text: "Mercury vapor lamps produce ultraviolet and visible light. They are used in street lighting, germicidal UV sterilization, and fluorescent tube manufacturing.", source: "mercury_element" },
  { title: "The Minamata Disease Disaster", text: "Minamata disease was caused by methylmercury discharge into Minamata Bay, Japan. Thousands suffered severe neurological damage from contaminated fish.", source: "mercury_element" },
  { title: "Mercury in Gold Mining", text: "Artisanal gold miners use mercury amalgamation to extract gold from ore. This releases toxic mercury into waterways and causes environmental contamination.", source: "mercury_element" },
  { title: "Physical Properties of Mercury", text: "Liquid mercury has a high surface tension and does not wet glass. Its high atomic weight gives it unusual density for a liquid metal.", source: "mercury_element" },
  { title: "The Minamata Convention on Mercury", text: "The Minamata Convention is an international treaty to reduce mercury pollution. It restricts mercury mining, product use, and emissions from industry.", source: "mercury_element" },
  { title: "Mercury Chloride Compounds", text: "Mercuric chloride (HgCl2) is a corrosive salt once used as a disinfectant. Mercurous chloride (calomel) was a historical purgative medicine.", source: "mercury_element" },
  { title: "Liquid Metal Batteries Using Mercury", text: "Mercury's liquid metal properties make it useful in switches and relays. Tilting mercury switches open and close circuits as orientation changes.", source: "mercury_element" },

  // ── MERCURY: Car Brand ────────────────────────────────────────────
  { title: "Mercury Automobiles History", text: "Mercury was a Ford Motor Company brand from 1938 to 2011. It occupied the mid-range segment between Ford and Lincoln.", source: "mercury_car" },
  { title: "Mercury Grand Marquis", text: "The Mercury Grand Marquis was a full-size rear-wheel-drive sedan popular with police fleets and taxi operators through the 1980s and 1990s.", source: "mercury_car" },
  { title: "Mercury Cougar Muscle Car", text: "The Mercury Cougar debuted in 1967 as a sporty personal luxury coupe. Early models shared a platform with the Ford Mustang.", source: "mercury_car" },
  { title: "Mercury Villager Minivan", text: "The Mercury Villager was a minivan developed jointly by Ford and Nissan in the 1990s. It competed with the Dodge Caravan and Honda Odyssey.", source: "mercury_car" },
  { title: "Ford Discontinues Mercury Brand", text: "Ford announced the discontinuation of the Mercury brand in 2010 due to declining sales. The final Mercury vehicles were produced in 2011.", source: "mercury_car" },
  { title: "Mercury Marquis Dealerships", text: "Mercury dealerships shared showrooms with Lincoln franchises. The Lincoln-Mercury division was a combined sales channel for Ford's premium lines.", source: "mercury_car" },
  { title: "Mercury Monterey Classic", text: "The Mercury Monterey was a classic American sedan from the 1950s. It featured chrome detailing, a V8 engine, and period-correct tailfins.", source: "mercury_car" },
  { title: "Mercury Sable Sedan", text: "The Mercury Sable was a mid-size front-wheel-drive sedan. It shared the Ford Taurus platform and featured an aero styling popular in the 1980s.", source: "mercury_car" },
  { title: "Mercury Marauder Performance Sedan", text: "The Mercury Marauder was a performance variant of the Grand Marquis with a 4.6L V8 engine, available from 2003–2004.", source: "mercury_car" },
  { title: "Collecting Classic Mercury Cars", text: "Vintage Mercury automobiles are collectible among American muscle car enthusiasts. The Cougar and Cyclone GT are particularly prized.", source: "mercury_car" },
  { title: "Mercury Topaz Compact", text: "The Mercury Topaz was a compact front-wheel-drive car sold from 1983–1994. It shared a platform with the Ford Tempo and was available as a sedan or coupe.", source: "mercury_car" },

  // ── PYTHON: Programming ───────────────────────────────────────────
  { title: "Python Programming Language", text: "Python is a high-level interpreted language. Its readable syntax, dynamic typing, and vast ecosystem make it popular for data science and web development.", source: "python_programming" },
  { title: "NumPy for Scientific Computing", text: "NumPy provides N-dimensional arrays and vectorized math operations for Python. It underpins pandas, scikit-learn, and most scientific Python libraries.", source: "python_programming" },
  { title: "Pandas DataFrame Guide", text: "Pandas provides labeled DataFrames for Python data analysis. It handles CSV ingestion, groupby aggregations, and missing value imputation.", source: "python_programming" },
  { title: "Python Decorators Explained", text: "Python decorators wrap functions with additional behavior using the @decorator syntax. They are used for logging, caching, and authentication in Python.", source: "python_programming" },
  { title: "FastAPI Web Framework", text: "FastAPI is a modern Python web framework using type hints and async/await. It generates OpenAPI docs automatically and rivals Node.js performance.", source: "python_programming" },
  { title: "pip Package Management", text: "pip is Python's package installer. Virtual environments via venv isolate Python project dependencies from the system interpreter.", source: "python_programming" },
  { title: "Python Type Hints and Mypy", text: "Python 3.5+ supports type annotations. Mypy performs static type checking on annotated Python code without runtime overhead.", source: "python_programming" },
  { title: "Asyncio Concurrency in Python", text: "Python's asyncio module enables cooperative multitasking with async/await coroutines. It powers high-concurrency networking and IO-bound workloads.", source: "python_programming" },
  { title: "PyTorch Deep Learning", text: "PyTorch is a Python deep learning framework with dynamic computation graphs. Tensors, autograd, and nn.Module are its core abstractions.", source: "python_programming" },
  { title: "Python List Comprehensions", text: "List comprehensions provide concise Python syntax for building lists: [x*2 for x in range(10) if x % 2 == 0]. They replace explicit loops.", source: "python_programming" },
  { title: "Django Full-Stack Framework", text: "Django is a batteries-included Python web framework. Its ORM, admin panel, and authentication system accelerate full-stack Python development.", source: "python_programming" },
  { title: "Python Testing with Pytest", text: "Pytest is Python's most popular testing framework. Fixtures, parametrize, and plugins make it flexible for unit and integration testing.", source: "python_programming" },
  { title: "Python Virtual Environments", text: "Python venv creates isolated environments with separate pip packages. Poetry and uv are modern alternatives for Python dependency management.", source: "python_programming" },
  { title: "Python Generator Functions", text: "Python generators use yield to produce values lazily. They enable memory-efficient iteration over large datasets without loading all data at once.", source: "python_programming" },
  { title: "Scikit-Learn Machine Learning", text: "Scikit-learn provides Python APIs for supervised and unsupervised machine learning. Pipelines chain preprocessing and model steps cleanly.", source: "python_programming" },

  // ── PYTHON: Snake ─────────────────────────────────────────────────
  { title: "Ball Python Care Guide", text: "Ball pythons are docile constrictor snakes popular as pets. They require a warm enclosure, humidity control, and pre-killed rodent prey.", source: "python_snake" },
  { title: "Burmese Python Invasive Species", text: "Burmese pythons are large constrictor snakes invading Florida's Everglades. They outcompete native predators and devastate mammal populations.", source: "python_snake" },
  { title: "Reticulated Python — World's Longest Snake", text: "The reticulated python is the longest snake species, reaching over 6 meters. Found in Southeast Asian rainforests, it is a powerful constrictor.", source: "python_snake" },
  { title: "Python Venom and Predation", text: "True pythons are non-venomous constrictors. They ambush prey, coil around it, and suffocate it before swallowing headfirst whole.", source: "python_snake" },
  { title: "Python Habitat and Distribution", text: "Pythons inhabit tropical and subtropical regions across Africa, Asia, and Australia. They prefer dense vegetation near water sources.", source: "python_snake" },
  { title: "Python Egg Incubation", text: "Female pythons are unusual among snakes in brooding their eggs. They coil around the clutch and shiver to generate metabolic heat.", source: "python_snake" },
  { title: "Green Tree Python Arboreal Behavior", text: "Green tree pythons are striking arboreal snakes from New Guinea. They coil on branches and strike downward at small birds and lizards.", source: "python_snake" },
  { title: "Blood Python Care", text: "Blood pythons are thick-bodied Southeast Asian snakes named for their reddish coloration. They require high humidity and are known for defensive temperaments.", source: "python_snake" },
  { title: "African Rock Python", text: "The African rock python is one of the largest snakes on Earth. It constricts large mammals including antelope and has been known to prey on crocodiles.", source: "python_snake" },
  { title: "Python Shedding and Skin", text: "Pythons shed their entire skin periodically as they grow. Before shedding, the eyes turn blue and the snake becomes less active and more defensive.", source: "python_snake" },
  { title: "Thermal Sensing in Pythons", text: "Pythons have heat-sensing pit organs along their lip scales. These infrared detectors allow them to locate warm-blooded prey in complete darkness.", source: "python_snake" },
  { title: "Python Digestion After Large Prey", text: "After swallowing a large meal, a python's metabolism accelerates dramatically. Digestion can take weeks; organs temporarily enlarge to process the prey.", source: "python_snake" },
  { title: "Python Conservation Status", text: "Several python species face habitat loss and poaching for the leather trade. The Indian python and Burmese python are listed on CITES appendices.", source: "python_snake" },
  { title: "Carpet Python Subspecies", text: "Carpet pythons are Australian constrictors with numerous regional subspecies. They are popular in the exotic pet trade for their varied patterning.", source: "python_snake" },
  { title: "Feeding Pythons in Captivity", text: "Captive pythons should be fed pre-killed or frozen-thawed prey to prevent injury. Feeding frequency depends on the snake's size and age.", source: "python_snake" },

  // ── SERVER: Technology ────────────────────────────────────────────
  { title: "Linux Server Administration", text: "Linux servers run Apache, nginx, and systemd. Administrators manage processes, users, file permissions, and networking via the command line.", source: "server_tech" },
  { title: "Nginx Reverse Proxy Setup", text: "Nginx acts as a reverse proxy in front of application servers. It handles SSL termination, load balancing, and static asset caching.", source: "server_tech" },
  { title: "DevOps Server Automation", text: "Ansible and Terraform automate server provisioning and configuration. Infrastructure as code enables repeatable, version-controlled deployments.", source: "server_tech" },
  { title: "Server Rack and Data Center Hardware", text: "Data center racks hold 1U and 2U servers with redundant power supplies. Cable management, cooling airflow, and KVM switches are key considerations.", source: "server_tech" },
  { title: "Docker Container Deployment", text: "Docker containers package application code with its runtime dependencies. Container orchestration via Kubernetes manages server workload scheduling.", source: "server_tech" },
  { title: "Server Monitoring with Prometheus", text: "Prometheus scrapes server metrics via exporters. Grafana dashboards visualize CPU, memory, disk IO, and network throughput across server fleets.", source: "server_tech" },
  { title: "SSH Server Hardening", text: "Hardening SSH involves disabling root login, using key-based authentication, and restricting ciphers. Fail2ban blocks brute-force login attempts.", source: "server_tech" },
  { title: "Web Server Load Balancing", text: "HAProxy distributes HTTP traffic across backend server pools. Health checks remove failed servers from rotation automatically.", source: "server_tech" },
  { title: "Bare Metal vs Cloud Servers", text: "Bare metal servers offer dedicated hardware without virtualization overhead. Cloud servers provide elastic scaling but share underlying physical infrastructure.", source: "server_tech" },
  { title: "Server Backup Strategies", text: "Server backups use rsync, Bacula, or cloud snapshots. The 3-2-1 rule recommends three copies on two media with one offsite.", source: "server_tech" },
  { title: "Apache HTTP Server Configuration", text: "Apache HTTP server uses virtual hosts and .htaccess files. Modules extend its functionality for SSL, proxying, and URL rewriting.", source: "server_tech" },
  { title: "Server CPU and Memory Sizing", text: "Server sizing depends on expected CPU cores, RAM, and disk IOPS. Benchmarking workloads before provisioning avoids over- or under-provisioning.", source: "server_tech" },
  { title: "Firewall and iptables on Linux Servers", text: "iptables and nftables manage packet filtering on Linux servers. UFW provides a simpler front-end for common server firewall rules.", source: "server_tech" },
  { title: "PostgreSQL Database Server Setup", text: "PostgreSQL runs as a server daemon accepting client connections. Configuration covers authentication, connection pooling via pgBouncer, and replication.", source: "server_tech" },
  { title: "CDN and Edge Server Architecture", text: "CDN edge servers cache static assets close to end users. Cloudflare and Fastly route requests to the nearest point of presence.", source: "server_tech" },
  { title: "RAID Storage on Servers", text: "RAID configurations protect server data against disk failure. RAID 10 combines mirroring and striping for both performance and redundancy.", source: "server_tech" },
  { title: "Server Virtualization with VMware", text: "VMware ESXi hypervisor partitions physical server hardware into virtual machines. vSphere manages VM lifecycle, snapshots, and live migration.", source: "server_tech" },
  { title: "CI/CD Pipeline Servers", text: "Jenkins and GitLab CI run automated build and test pipelines on dedicated server infrastructure. Agents execute jobs in parallel across server nodes.", source: "server_tech" },

  // ── SERVER: Hospitality ───────────────────────────────────────────
  { title: "Restaurant Server Training Guide", text: "Restaurant servers must memorize the menu, know allergens, and anticipate guest needs. Professional table service requires attentiveness and speed.", source: "server_hospitality" },
  { title: "Wine Service for Waitstaff", text: "Servers present the wine bottle, open it tableside, and pour a taste for the host. Proper wine service includes correct glassware and temperature.", source: "server_hospitality" },
  { title: "Handling Difficult Diners as a Server", text: "Experienced servers de-escalate complaints with empathy and prompt action. Offering a complimentary dish or manager visit can recover a difficult table.", source: "server_hospitality" },
  { title: "Server Tip Pooling Policies", text: "Many restaurants require servers to tip out bussers, bartenders, and food runners. Tip pooling policies vary by state law and restaurant policy.", source: "server_hospitality" },
  { title: "Fine Dining Table Service Etiquette", text: "Fine dining servers follow strict protocols: serve from the left, clear from the right, and never reach across a guest. Eye contact and discretion matter.", source: "server_hospitality" },
  { title: "Point of Sale Systems for Servers", text: "Servers use POS terminals to enter orders, split bills, and process payment. Modern POS tablets allow tableside ordering and card-present transactions.", source: "server_hospitality" },
  { title: "Food Allergen Awareness for Servers", text: "Servers must communicate allergen risks accurately. Cross-contamination, ingredient substitutions, and kitchen preparation protocols are server responsibilities.", source: "server_hospitality" },
  { title: "Upselling Techniques for Restaurant Servers", text: "Effective servers suggest appetizers, premium beverages, and desserts. Upselling increases average check size while genuinely enhancing the dining experience.", source: "server_hospitality" },
  { title: "Shift Work and Server Scheduling", text: "Restaurant servers work split shifts, doubles, and weekends. Scheduling apps like 7Shifts help managers balance server floor coverage and labor costs.", source: "server_hospitality" },
  { title: "Bar and Restaurant Server Teamwork", text: "Successful restaurant service depends on server-kitchen coordination. Clear communication with the expo and chef prevents errors and delays.", source: "server_hospitality" },
  { title: "Catering and Banquet Server Roles", text: "Banquet servers set up event spaces, carry trays, and serve plated dinners simultaneously to large groups. Timing and coordination are critical.", source: "server_hospitality" },
  { title: "Tipped Minimum Wage and Server Pay", text: "In the US, tipped servers may earn a lower direct wage with tips making up the difference to minimum wage. Tip credit rules vary by state.", source: "server_hospitality" },
  { title: "Body Language for Front-of-House Staff", text: "Positive body language — eye contact, open posture, and genuine smiles — builds rapport between servers and guests, increasing satisfaction and tips.", source: "server_hospitality" },
  { title: "Server Sidework and Closing Duties", text: "Servers perform sidework before and after shifts: rolling silverware, stocking stations, wiping menus, and sweeping their section.", source: "server_hospitality" },
  { title: "Food Safety Training for Servers", text: "Servers should understand safe food temperatures, handwashing protocols, and signs of foodborne illness. ServSafe certification is required in many states.", source: "server_hospitality" },
  { title: "Outdoor and Patio Server Challenges", text: "Patio servers manage weather changes, insects, and sun glare that affect outdoor dining. Extra attentiveness and flexibility are required.", source: "server_hospitality" },
  { title: "Server Burnout in the Restaurant Industry", text: "High-stress service environments cause burnout among restaurant servers. Heavy workloads, difficult guests, and unpredictable income contribute to turnover.", source: "server_hospitality" },
];

async function main() {
  console.log("Setting up Solr core...");
  await ensureCore();

  console.log(`\nEmbedding ${RAW_DOCS.length} documents (first run downloads model ~22MB)...`);

  const texts = RAW_DOCS.map((d) => `${d.title} ${d.text}`);
  const vectors = await embedBatch(texts);

  const docs: Doc[] = RAW_DOCS.map((d, i) => ({
    id: randomUUID(),
    title: d.title,
    text: d.text,
    source: d.source,
    vector: vectors[i],
  }));

  console.log("\nFactorizing synthetic persona interactions into behavioral vectors...");
  const interactions = generateInteractions(docs);
  const { itemVectors } = factorize(interactions);
  docs.forEach((doc, i) => (doc.behaviorVector = itemVectors[i]));

  console.log("\nInserting documents into Solr...");
  await insertDocuments(docs);

  console.log("\nDone. Run: npm run cli");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
